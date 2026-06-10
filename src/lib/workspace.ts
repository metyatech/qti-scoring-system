import fs from 'fs';
import path from 'path';
import { QtiWorkspace, QtiWorkspaceSummary, UpdateWorkspaceRequest } from '@/types/qti';

const WORKSPACE_META = 'workspace.json';

const fileLocks = new Map<string, Promise<unknown>>();

const withFileLock = async <T>(filePath: string, fn: () => Promise<T>): Promise<T> => {
  const prev = fileLocks.get(filePath) || Promise.resolve();
  let result: T;
  const exec = prev.then(fn).then(r => { result = r; });
  fileLocks.set(filePath, exec.catch(() => {}));
  try {
    await exec;
    return result!;
  } finally {
    if (fileLocks.get(filePath) === exec.catch(() => {})) {
      fileLocks.delete(filePath);
    }
  }
};

const atomicWriteFile = async (filePath: string, data: string) => {
  const tmpPath = filePath + '.tmp';
  const bakPath = filePath + '.bak';
  if (fs.existsSync(filePath)) {
    try { await fs.promises.copyFile(filePath, bakPath); } catch { /* ignore */ }
  }
  await fs.promises.writeFile(tmpPath, data, 'utf-8');
  await fs.promises.rename(tmpPath, filePath);
};

const atomicWriteJson = async (filePath: string, data: unknown) => {
  await atomicWriteFile(filePath, JSON.stringify(data, null, 2));
};

// ---------------------------------------------------------------------------
// Storage mode
//
// The scoring system supports two storage modes:
//
// - index mode: when QTI_SCORING_SYSTEM_REPO_ROOT and
//   QTI_SCORING_SYSTEM_WORKSPACE_INDEX are both set, workspace directories are
//   the source of truth inside an external course-exams checkout. The index
//   file maps each workspace id to its on-disk `result/scoring-workspace`
//   directory. A single running process can therefore surface workspaces from
//   many exams at once.
//
// - legacy mode: when the env vars are not set, workspaces are stored flat
//   under `<cwd>/data/workspaces/<id>` (the historical behavior used by the
//   standalone app and export/import flow).
// ---------------------------------------------------------------------------

export interface WorkspaceIndexConfig {
  repoRoot: string;
  indexPath: string;
}

interface WorkspaceIndexEntry {
  id: string;
  assessmentDir?: string;
  workspaceDir: string;
  name?: string;
  updatedAt?: string;
}

interface WorkspaceIndexFile {
  version?: number;
  generatedAt?: string;
  workspaces?: WorkspaceIndexEntry[];
}

const getLegacyDataDir = () => path.join(process.cwd(), 'data', 'workspaces');

export const getWorkspaceIndexConfig = (): WorkspaceIndexConfig | null => {
  const repoRoot = process.env.QTI_SCORING_SYSTEM_REPO_ROOT;
  const indexPath = process.env.QTI_SCORING_SYSTEM_WORKSPACE_INDEX;
  if (repoRoot && repoRoot.trim() !== '' && indexPath && indexPath.trim() !== '') {
    return { repoRoot: path.resolve(repoRoot.trim()), indexPath: path.resolve(indexPath.trim()) };
  }
  return null;
};

export const getWorkspaceMode = (): 'index' | 'legacy' =>
  getWorkspaceIndexConfig() === null ? 'legacy' : 'index';

const toPosix = (value: string) => value.split(path.sep).join('/');

// Only `courses/**/exams/**/result/scoring-workspace` directories are accepted
// as external workspace locations. `.` matches `/`, so the `.+` segments span
// nested course/exam paths.
const WORKSPACE_DIR_PATTERN = /^courses\/.+\/exams\/.+\/result\/scoring-workspace$/u;

/**
 * Resolve and validate an external workspace directory.
 *
 * Accepts a repo-relative (preferred) or absolute path. The resolved path MUST
 * stay within `repoRoot` and MUST match the canonical
 * `courses/**​/exams/**​/result/scoring-workspace` shape. Throws otherwise.
 */
export const validateWorkspaceDirWithinRepo = (repoRoot: string, input: string): string => {
  const trimmed = (input ?? '').replace(/\\/g, '/').trim();
  if (!trimmed) {
    throw new Error('workspaceDir が空です');
  }
  const resolvedRoot = path.resolve(repoRoot);
  const absolute = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(resolvedRoot, trimmed);
  const relative = path.relative(resolvedRoot, absolute);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`workspaceDir が repo root の外を指しています: ${input}`);
  }
  const relPosix = toPosix(relative);
  if (!WORKSPACE_DIR_PATTERN.test(relPosix)) {
    throw new Error(
      `workspaceDir のパス形式が不正です (courses/**/exams/**/result/scoring-workspace 以外): ${input}`
    );
  }
  return absolute;
};

const readIndexEntries = async (indexPath: string): Promise<WorkspaceIndexEntry[]> => {
  try {
    const content = await fs.promises.readFile(indexPath, 'utf-8');
    const parsed = JSON.parse(content) as WorkspaceIndexFile;
    return Array.isArray(parsed.workspaces) ? parsed.workspaces : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    console.error(`scoring-workspace-index.json の読み込みに失敗: ${indexPath}`, error);
    return [];
  }
};

/**
 * Resolve the absolute directory for a workspace id.
 *
 * In index mode the index is read on every call so course-exams updates are
 * reflected without restarting the scoring system. Returns null when the id is
 * unknown or its index entry points to an invalid directory.
 */
export const resolveWorkspaceDir = async (id: string): Promise<string | null> => {
  const config = getWorkspaceIndexConfig();
  if (config === null) {
    return path.join(getLegacyDataDir(), id);
  }
  const entries = await readIndexEntries(config.indexPath);
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry || !entry.workspaceDir) {
    return null;
  }
  try {
    return validateWorkspaceDirWithinRepo(config.repoRoot, entry.workspaceDir);
  } catch (error) {
    console.warn(`index entry ${id} の workspaceDir が不正です:`, error);
    return null;
  }
};

export const getWorkspacesRoot = () => getLegacyDataDir();

const ensureLegacyDataDir = () => {
  const dir = getLegacyDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

export const ensureWorkspaceSubdirsAt = async (workspaceDir: string): Promise<string> => {
  await fs.promises.mkdir(path.join(workspaceDir, 'assessment'), { recursive: true });
  await fs.promises.mkdir(path.join(workspaceDir, 'items'), { recursive: true });
  await fs.promises.mkdir(path.join(workspaceDir, 'results'), { recursive: true });
  return workspaceDir;
};

export const writeWorkspaceMetaAt = async (
  workspaceDir: string,
  workspace: QtiWorkspace
): Promise<void> => {
  await fs.promises.mkdir(workspaceDir, { recursive: true });
  const metaPath = path.join(workspaceDir, WORKSPACE_META);
  await withFileLock(metaPath, async () => {
    await atomicWriteJson(metaPath, workspace);
  });
};

export const readWorkspace = async (id: string): Promise<QtiWorkspace | null> => {
  const workspaceDir = await resolveWorkspaceDir(id);
  if (workspaceDir === null) return null;
  try {
    const content = await fs.promises.readFile(path.join(workspaceDir, WORKSPACE_META), 'utf-8');
    return JSON.parse(content) as QtiWorkspace;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`ワークスペース ${id} の取得に失敗:`, error);
    }
    return null;
  }
};

export const writeWorkspace = async (workspace: QtiWorkspace): Promise<void> => {
  const workspaceDir = await resolveWorkspaceDir(workspace.id);
  if (workspaceDir === null) {
    throw new Error(`ワークスペースの保存先を解決できません: ${workspace.id}`);
  }
  await writeWorkspaceMetaAt(workspaceDir, workspace);
};

const toSummary = (workspace: QtiWorkspace): QtiWorkspaceSummary => ({
  id: workspace.id,
  name: workspace.name,
  description: workspace.description,
  createdAt: workspace.createdAt,
  updatedAt: workspace.updatedAt,
  itemCount: workspace.itemCount,
  resultCount: workspace.resultCount,
});

const byUpdatedDesc = (a: QtiWorkspaceSummary, b: QtiWorkspaceSummary) =>
  new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();

const listLegacyWorkspaces = async (): Promise<QtiWorkspaceSummary[]> => {
  const dataDir = ensureLegacyDataDir();
  try {
    const entries = await fs.promises.readdir(dataDir, { withFileTypes: true });
    const summaries: QtiWorkspaceSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metaPath = path.join(dataDir, entry.name, WORKSPACE_META);
      if (!fs.existsSync(metaPath)) continue;
      try {
        const content = await fs.promises.readFile(metaPath, 'utf-8');
        summaries.push(toSummary(JSON.parse(content) as QtiWorkspace));
      } catch (error) {
        console.error(`workspace.json 読み込み失敗: ${metaPath}`, error);
      }
    }
    return summaries.sort(byUpdatedDesc);
  } catch (error) {
    console.error('ワークスペース一覧の取得に失敗:', error);
    return [];
  }
};

const listIndexedWorkspaces = async (
  config: WorkspaceIndexConfig
): Promise<QtiWorkspaceSummary[]> => {
  const entries = await readIndexEntries(config.indexPath);
  const summaries: QtiWorkspaceSummary[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry.id || seen.has(entry.id)) continue;
    let workspaceDir: string;
    try {
      workspaceDir = validateWorkspaceDirWithinRepo(config.repoRoot, entry.workspaceDir);
    } catch (error) {
      console.warn(`index entry ${entry.id} を一覧から除外 (workspaceDir 不正):`, error);
      continue;
    }
    const metaPath = path.join(workspaceDir, WORKSPACE_META);
    let content: string;
    try {
      content = await fs.promises.readFile(metaPath, 'utf-8');
    } catch {
      // Stale index entry whose workspace.json no longer exists: skip silently.
      continue;
    }
    try {
      const workspace = JSON.parse(content) as QtiWorkspace;
      seen.add(entry.id);
      summaries.push(toSummary(workspace));
    } catch (error) {
      console.warn(`workspace.json が壊れているため一覧から除外: ${metaPath}`, error);
    }
  }
  return summaries.sort(byUpdatedDesc);
};

export const listWorkspaces = async (): Promise<QtiWorkspaceSummary[]> => {
  const config = getWorkspaceIndexConfig();
  return config === null ? listLegacyWorkspaces() : listIndexedWorkspaces(config);
};

export const updateWorkspace = async (
  id: string,
  updates: UpdateWorkspaceRequest
): Promise<QtiWorkspace | null> => {
  const existing = await readWorkspace(id);
  if (!existing) return null;
  const updated: QtiWorkspace = {
    ...existing,
    name: updates.name?.trim() || existing.name,
    description: updates.description?.trim() || undefined,
    updatedAt: new Date().toISOString(),
  };
  await writeWorkspace(updated);
  return updated;
};

export const deleteWorkspace = async (id: string): Promise<boolean> => {
  const workspaceDir = await resolveWorkspaceDir(id);
  if (workspaceDir === null) return false;
  try {
    await fs.promises.rm(workspaceDir, { recursive: true, force: true });
    return true;
  } catch (error) {
    console.error(`ワークスペース ${id} の削除に失敗:`, error);
    return false;
  }
};

export const updateResultXml = async (id: string, resultFile: string, xml: string): Promise<void> => {
  const workspaceDir = await resolveWorkspaceDir(id);
  if (workspaceDir === null) {
    throw new Error(`ワークスペースの保存先を解決できません: ${id}`);
  }
  const resultPath = path.join(workspaceDir, 'results', resultFile);
  await withFileLock(resultPath, async () => {
    await atomicWriteFile(resultPath, xml);
  });
};

export const sanitizeFileName = (name: string) =>
  name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();

export const sanitizeRelativePath = (value: string) => {
  const replaced = value.replace(/\\/g, '/').trim();
  const withoutDrive = replaced.replace(/^[A-Za-z]:/, '');
  const stripped = withoutDrive.replace(/^\/+/, '');
  const normalized = path.posix.normalize(stripped);
  if (!normalized || normalized === '.') {
    throw new Error('相対パスが空です');
  }
  if (normalized.startsWith('..') || normalized.includes('/..')) {
    throw new Error(`不正な相対パスです: ${value}`);
  }
  return normalized;
};
