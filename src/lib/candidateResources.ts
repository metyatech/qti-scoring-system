import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import {
  CandidateResourceDefinition,
  getWorkspaceIndexConfig,
  getWorkspaceIndexEntry,
  readWorkspace,
  sanitizeResultFileName,
  validateWorkspaceDirWithinRepo,
  WorkspaceIndexEntry
} from "@/lib/workspace";

export const RESOURCE_MARKER_SUFFIX = ".course-assessment-resource.json";
const MAX_RAW_ZIP_BYTES = 256 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 10_000;
const MAX_ZIP_ENTRY_BYTES = 256 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 1024 * 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export type CandidateResourceSummary = Pick<
  CandidateResourceDefinition,
  "id" | "label" | "type"
>;

export type CandidateResourceErrorCode = "not-found" | "conflict" | "unsafe" | "open";

export class CandidateResourceError extends Error {
  readonly code: CandidateResourceErrorCode;

  constructor(code: CandidateResourceErrorCode, message: string) {
    super(message);
    this.name = "CandidateResourceError";
    this.code = code;
  }
}

type ResolvedResource = {
  definition: CandidateResourceDefinition;
  targetPath: string;
  markerPath: string;
  sourcePath?: string;
};

type PlannedZipEntry = {
  entry: AdmZip.IZipEntry;
  destination: string;
  relativePath: string;
  size: number;
};

const isContained = (parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const isContainedOrEqual = (parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const assertSafeRepoRelativePosixPath = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new CandidateResourceError("unsafe", `${field} が不正です`);
  }
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/u.test(value)) {
    throw new CandidateResourceError("unsafe", `${field} は repo-relative POSIX path である必要があります`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new CandidateResourceError("unsafe", `${field} に不正な path segment があります`);
  }
  return value;
};

const assertResourceDefinition = (value: unknown): CandidateResourceDefinition => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CandidateResourceError("unsafe", "candidate resource が不正です");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(record.id) ||
    typeof record.label !== "string" ||
    record.label.trim() === "" ||
    record.type !== "folder"
  ) {
    throw new CandidateResourceError("unsafe", "candidate resource の定義が不正です");
  }
  const resource: CandidateResourceDefinition = {
    id: record.id,
    label: record.label,
    type: "folder",
    path: assertSafeRepoRelativePosixPath(record.path, "resource.path")
  };
  if (record.prepare !== undefined) {
    if (typeof record.prepare !== "object" || record.prepare === null || Array.isArray(record.prepare)) {
      throw new CandidateResourceError("unsafe", "resource.prepare が不正です");
    }
    const prepare = record.prepare as Record<string, unknown>;
    if (
      prepare.type !== "extract-zip" ||
      typeof prepare.sourceSha256 !== "string" ||
      !SHA256_PATTERN.test(prepare.sourceSha256)
    ) {
      throw new CandidateResourceError("unsafe", "resource.prepare の定義が不正です");
    }
    resource.prepare = {
      type: "extract-zip",
      sourcePath: assertSafeRepoRelativePosixPath(prepare.sourcePath, "prepare.sourcePath"),
      sourceSha256: prepare.sourceSha256
    };
  }
  return resource;
};

const assertExistingAncestorContained = async (
  assessmentDir: string,
  candidate: string
): Promise<void> => {
  const assessmentReal = await fs.promises.realpath(assessmentDir);
  let existing = candidate;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) {
      throw new CandidateResourceError("unsafe", `path の ancestor を検証できません: ${candidate}`);
    }
    existing = parent;
  }
  const existingReal = await fs.promises.realpath(existing);
  if (!isContainedOrEqual(assessmentReal, existingReal)) {
    throw new CandidateResourceError("unsafe", `assessmentDir 外の path は使用できません: ${candidate}`);
  }
};

const resolveRepoPathInsideAssessment = async (
  repoRoot: string,
  assessmentDir: string,
  value: string,
  field: string
): Promise<string> => {
  const relative = assertSafeRepoRelativePosixPath(value, field);
  const resolvedRoot = path.resolve(repoRoot);
  const resolvedAssessment = path.resolve(resolvedRoot, ...assessmentDir.split("/"));
  const resolved = path.resolve(resolvedRoot, ...relative.split("/"));
  if (!isContained(resolvedRoot, resolved) || !isContained(resolvedAssessment, resolved)) {
    throw new CandidateResourceError("unsafe", `${field} が assessmentDir の外を指しています`);
  }
  await assertExistingAncestorContained(resolvedAssessment, resolved);
  if (fs.existsSync(resolved)) {
    const realResolved = await fs.promises.realpath(resolved);
    const realAssessment = await fs.promises.realpath(resolvedAssessment);
    if (!isContained(realAssessment, realResolved)) {
      throw new CandidateResourceError("unsafe", `${field} が symlink 経由で assessmentDir 外を指しています`);
    }
  }
  return resolved;
};

const resolveResource = async (
  entry: WorkspaceIndexEntry,
  definition: unknown
): Promise<ResolvedResource> => {
  const config = getWorkspaceIndexConfig();
  if (config === null || typeof entry.assessmentDir !== "string") {
    throw new CandidateResourceError("not-found", "candidate resource は利用できません");
  }
  const safeDefinition = assertResourceDefinition(definition);
  const assessmentDir = assertSafeRepoRelativePosixPath(entry.assessmentDir, "assessmentDir");
  const assessmentAbsolute = path.resolve(config.repoRoot, ...assessmentDir.split("/"));
  const workspaceAbsolute = validateWorkspaceDirWithinRepo(config.repoRoot, entry.workspaceDir);
  if (!isContained(config.repoRoot, assessmentAbsolute) || !isContained(config.repoRoot, workspaceAbsolute)) {
    throw new CandidateResourceError("unsafe", "workspace index entry が repo 外を指しています");
  }
  await fs.promises.realpath(assessmentAbsolute);
  const targetPath = await resolveRepoPathInsideAssessment(
    config.repoRoot,
    assessmentDir,
    safeDefinition.path,
    "resource.path"
  );
  const sourcePath = safeDefinition.prepare === undefined
    ? undefined
    : await resolveRepoPathInsideAssessment(
        config.repoRoot,
        assessmentDir,
        safeDefinition.prepare.sourcePath,
        "prepare.sourcePath"
      );
  return {
    definition: safeDefinition,
    targetPath,
    markerPath: `${targetPath}${RESOURCE_MARKER_SUFFIX}`,
    ...(sourcePath === undefined ? {} : { sourcePath })
  };
};

export const getCandidateResourceSummaries = async (
  id: string,
  resultFile: string
): Promise<CandidateResourceSummary[]> => {
  const config = getWorkspaceIndexConfig();
  if (config === null) return [];
  const workspace = await readWorkspace(id);
  if (workspace === null) throw new CandidateResourceError("not-found", "workspace が見つかりません");
  let safeResultFile: string;
  try {
    safeResultFile = sanitizeResultFileName(resultFile);
  } catch {
    throw new CandidateResourceError("not-found", "result file が見つかりません");
  }
  if (!workspace.resultFiles.includes(safeResultFile)) {
    throw new CandidateResourceError("not-found", "result file が見つかりません");
  }
  const entry = await getWorkspaceIndexEntry(id);
  if (entry === null) throw new CandidateResourceError("not-found", "workspace が見つかりません");
  const resources = entry.candidateResources?.[safeResultFile] ?? [];
  if (!Array.isArray(resources)) {
    throw new CandidateResourceError("unsafe", "candidate resource index が不正です");
  }
  const summaries: CandidateResourceSummary[] = [];
  for (const resource of resources) {
    const resolved = await resolveResource(entry, resource);
    summaries.push({
      id: resolved.definition.id,
      label: resolved.definition.label,
      type: resolved.definition.type
    });
  }
  return summaries;
};

const markerMatches = async (markerPath: string, sourceSha256: string): Promise<boolean> => {
  try {
    const parsed = JSON.parse(await readFile(markerPath, "utf8")) as Record<string, unknown>;
    return (
      parsed.schemaVersion === 1 &&
      parsed.prepareType === "extract-zip" &&
      parsed.sourceSha256 === sourceSha256
    );
  } catch {
    return false;
  }
};

const isDirectory = async (candidate: string): Promise<boolean> => {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
};

const validateZipEntryPath = (rawName: string): string => {
  if (rawName.includes("\0")) throw new CandidateResourceError("unsafe", "ZIP entry に NUL があります");
  const portable = rawName.replaceAll("\\", "/");
  if (portable.startsWith("/") || /^[A-Za-z]:/u.test(portable) || portable.startsWith("//")) {
    throw new CandidateResourceError("unsafe", `ZIP entry path が絶対パスです: ${rawName}`);
  }
  const segments = portable.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new CandidateResourceError("unsafe", `ZIP entry path に traversal があります: ${rawName}`);
  }
  const relative = segments.filter((segment) => segment !== "").join("/");
  if (relative === "") throw new CandidateResourceError("unsafe", "空の ZIP entry path です");
  return relative;
};

const isZipSymlink = (entry: AdmZip.IZipEntry): boolean => {
  const unixMode = ((entry.attr ?? 0) >>> 16) & 0xffff;
  return (unixMode & 0o170000) === 0o120000;
};

const readPlannedZipEntries = (archive: Buffer, stagingDir: string): PlannedZipEntry[] => {
  if (archive.byteLength > MAX_RAW_ZIP_BYTES) {
    throw new CandidateResourceError("unsafe", "raw ZIP がサイズ上限を超えています");
  }
  let zip: AdmZip;
  try {
    zip = new AdmZip(archive);
  } catch (error) {
    throw new CandidateResourceError("unsafe", `ZIP を読み込めません: ${String(error)}`);
  }
  const entries = zip.getEntries();
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new CandidateResourceError("unsafe", "ZIP の entry 数が上限を超えています");
  }
  const seen = new Set<string>();
  const filePaths = new Set<string>();
  const planned: PlannedZipEntry[] = [];
  let total = 0;
  for (const entry of entries) {
    const rawName = entry.rawEntryName.toString("utf8");
    const relativePath = validateZipEntryPath(rawName);
    if (isZipSymlink(entry)) {
      throw new CandidateResourceError("unsafe", `ZIP symlink entry は使用できません: ${rawName}`);
    }
    const key = relativePath.toLocaleLowerCase("en-US");
    if (seen.has(key)) {
      throw new CandidateResourceError("unsafe", `ZIP に重複 destination があります: ${rawName}`);
    }
    seen.add(key);
    const size = entry.header.size;
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_ZIP_ENTRY_BYTES) {
      throw new CandidateResourceError("unsafe", `ZIP entry のサイズが上限を超えています: ${rawName}`);
    }
    total += size;
    if (!Number.isSafeInteger(total) || total > MAX_ZIP_TOTAL_BYTES) {
      throw new CandidateResourceError("unsafe", "展開後の合計サイズが上限を超えています");
    }
    if (!entry.isDirectory) filePaths.add(key);
    planned.push({
      entry,
      relativePath,
      destination: path.resolve(stagingDir, ...relativePath.split("/")),
      size
    });
  }
  for (const plannedEntry of planned) {
    const relativeSegments = plannedEntry.relativePath.split("/");
    for (let i = 1; i < relativeSegments.length; i += 1) {
      if (filePaths.has(relativeSegments.slice(0, i).join("/").toLocaleLowerCase("en-US"))) {
        throw new CandidateResourceError("unsafe", "ZIP に file/directory collision があります");
      }
    }
  }
  return planned;
};

const extractZipSafely = async (archive: Buffer, stagingDir: string): Promise<void> => {
  const planned = readPlannedZipEntries(archive, stagingDir);
  await mkdir(stagingDir, { recursive: true });
  for (const { entry, destination, size } of planned) {
    if (entry.isDirectory) {
      await mkdir(destination, { recursive: true });
      continue;
    }
    const data = entry.getData();
    if (data.byteLength !== size || data.byteLength > MAX_ZIP_ENTRY_BYTES) {
      throw new CandidateResourceError("unsafe", `ZIP entry の実データサイズが一致しません: ${entry.entryName}`);
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, data, { flag: "wx" });
  }
};

const atomicWriteMarker = async (markerPath: string, sourceSha256: string): Promise<void> => {
  const tempPath = `${markerPath}.${process.pid}.${randomUUID()}.tmp`;
  const backupPath = `${markerPath}.${process.pid}.${randomUUID()}.backup`;
  let backedUp = false;
  try {
    await writeFile(
      tempPath,
      `${JSON.stringify({ schemaVersion: 1, prepareType: "extract-zip", sourceSha256 }, null, 2)}\n`,
      "utf8"
    );
    if (fs.existsSync(markerPath)) {
      await rename(markerPath, backupPath);
      backedUp = true;
    }
    try {
      await rename(tempPath, markerPath);
    } catch (error) {
      if (backedUp) {
        await rename(backupPath, markerPath).catch(() => undefined);
      }
      throw error;
    }
    if (backedUp) await rm(backupPath, { force: true });
  } finally {
    await rm(tempPath, { force: true });
    await rm(backupPath, { force: true });
  }
};

const replaceExtractedDirectory = async (
  targetPath: string,
  archive: Buffer
): Promise<void> => {
  const parent = path.dirname(targetPath);
  await mkdir(parent, { recursive: true });
  await assertExistingAncestorContained(parent, targetPath);
  const stagingPath = await mkdtemp(path.join(parent, `${path.basename(targetPath)}.staging-`));
  const backupPath = `${targetPath}.backup-${process.pid}-${randomUUID()}`;
  let backupTaken = false;
  try {
    await extractZipSafely(archive, stagingPath);
    if (fs.existsSync(targetPath)) {
      const targetStat = await lstat(targetPath);
      if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
        throw new CandidateResourceError("unsafe", "展開先が directory ではありません");
      }
      await rename(targetPath, backupPath);
      backupTaken = true;
    }
    try {
      await rename(stagingPath, targetPath);
    } catch (error) {
      if (backupTaken) await rename(backupPath, targetPath).catch(() => undefined);
      throw error;
    }
    if (backupTaken) {
      await rm(backupPath, { recursive: true, force: true });
      if (fs.existsSync(backupPath)) {
        throw new CandidateResourceError("unsafe", "古い展開先の cleanup に失敗しました");
      }
    }
  } finally {
    await rm(stagingPath, { recursive: true, force: true });
  }
};

const prepareResource = async (resource: ResolvedResource): Promise<void> => {
  const prepare = resource.definition.prepare;
  if (prepare === undefined || resource.sourcePath === undefined) return;
  let sourceStat;
  try {
    sourceStat = await stat(resource.sourcePath);
  } catch {
    throw new CandidateResourceError("not-found", "提出 ZIP が見つかりません");
  }
  if (!sourceStat.isFile()) throw new CandidateResourceError("unsafe", "提出 ZIP が file ではありません");
  const archive = await readFile(resource.sourcePath);
  const actualSha256 = createHash("sha256").update(archive).digest("hex");
  if (actualSha256 !== prepare.sourceSha256) {
    throw new CandidateResourceError("conflict", "提出 ZIP の SHA-256 が変わっています");
  }
  await replaceExtractedDirectory(resource.targetPath, archive);
  await atomicWriteMarker(resource.markerPath, prepare.sourceSha256);
};

export const openCandidateResource = async (
  id: string,
  resultFile: string,
  resourceId: string
): Promise<void> => {
  const config = getWorkspaceIndexConfig();
  if (config === null) throw new CandidateResourceError("not-found", "candidate resource は利用できません");
  const workspace = await readWorkspace(id);
  if (workspace === null) throw new CandidateResourceError("not-found", "workspace が見つかりません");
  let safeResultFile: string;
  try {
    safeResultFile = sanitizeResultFileName(resultFile);
  } catch {
    throw new CandidateResourceError("not-found", "result file が見つかりません");
  }
  if (!workspace.resultFiles.includes(safeResultFile)) {
    throw new CandidateResourceError("not-found", "result file が見つかりません");
  }
  const entry = await getWorkspaceIndexEntry(id);
  if (entry === null) throw new CandidateResourceError("not-found", "workspace が見つかりません");
  const resources = entry.candidateResources?.[safeResultFile];
  if (!Array.isArray(resources)) throw new CandidateResourceError("not-found", "resource が見つかりません");
  const definition = resources.find((candidate) =>
    typeof candidate === "object" && candidate !== null && candidate.id === resourceId
  );
  if (definition === undefined) throw new CandidateResourceError("not-found", "resource が見つかりません");
  const resource = await resolveResource(entry, definition);
  if (resource.definition.prepare !== undefined) {
    const targetReady = (await isDirectory(resource.targetPath)) &&
      await markerMatches(resource.markerPath, resource.definition.prepare.sourceSha256);
    if (!targetReady) await prepareResource(resource);
  } else if (!(await isDirectory(resource.targetPath))) {
    throw new CandidateResourceError("not-found", "展開済み提出物フォルダが見つかりません");
  }
  if (!(await isDirectory(resource.targetPath))) {
    throw new CandidateResourceError("unsafe", "展開先が directory ではありません");
  }
  await launchFileManager(resource.targetPath);
};

export const getFileManagerCommand = (
  platform: NodeJS.Platform,
  folderPath: string
): { command: string; args: string[] } => {
  if (platform === "win32") return { command: "explorer.exe", args: [folderPath] };
  if (platform === "darwin") return { command: "open", args: [folderPath] };
  return { command: "xdg-open", args: [folderPath] };
};

const launchFileManager = async (folderPath: string): Promise<void> => {
  const { command, args } = getFileManagerCommand(process.platform, folderPath);
  await new Promise<void>((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { shell: false, stdio: "ignore", detached: true });
    } catch (error) {
      reject(new CandidateResourceError("open", `ファイルマネージャーを起動できません: ${String(error)}`));
      return;
    }
    child.once("error", (error) => {
      reject(new CandidateResourceError("open", `ファイルマネージャーを起動できません: ${String(error)}`));
    });
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
};

// Test-only exports keep the production API small while allowing the safety
// limits and replacement behavior to be exercised without opening a desktop.
export const validateCandidateResourceDefinitionForTest = assertResourceDefinition;
export const validateZipEntryPathForTest = validateZipEntryPath;
export const extractZipSafelyForTest = extractZipSafely;
export const replaceExtractedDirectoryForTest = replaceExtractedDirectory;
