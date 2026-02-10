import fs from "fs";
import path from "path";
import {
  QtiWorkspace,
  QtiWorkspaceSummary,
  UpdateWorkspaceRequest,
} from "@/types/qti";

const DATA_DIR = path.join(process.cwd(), "data", "workspaces");
const WORKSPACE_META = "workspace.json";

const fileLocks = new Map<string, Promise<unknown>>();

const withFileLock = async <T>(
  filePath: string,
  fn: () => Promise<T>
): Promise<T> => {
  const prev = fileLocks.get(filePath) || Promise.resolve();
  let result: T;
  const exec = prev.then(fn).then((r) => {
    result = r;
  });
  fileLocks.set(
    filePath,
    exec.catch(() => {})
  );
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
  const tmpPath = filePath + ".tmp";
  const bakPath = filePath + ".bak";
  if (fs.existsSync(filePath)) {
    try {
      await fs.promises.copyFile(filePath, bakPath);
    } catch {
      /* ignore */
    }
  }
  await fs.promises.writeFile(tmpPath, data, "utf-8");
  await fs.promises.rename(tmpPath, filePath);
};

const atomicWriteJson = async (filePath: string, data: unknown) => {
  await atomicWriteFile(filePath, JSON.stringify(data, null, 2));
};

const ensureDataDir = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
};

export const getWorkspaceDir = (id: string) => path.join(DATA_DIR, id);

export const getWorkspacesRoot = () => DATA_DIR;

export const getWorkspaceMetaPath = (id: string) =>
  path.join(getWorkspaceDir(id), WORKSPACE_META);

export const getAssessmentDir = (id: string) =>
  path.join(getWorkspaceDir(id), "assessment");

export const readWorkspace = async (
  id: string
): Promise<QtiWorkspace | null> => {
  ensureDataDir();
  try {
    const content = await fs.promises.readFile(
      getWorkspaceMetaPath(id),
      "utf-8"
    );
    return JSON.parse(content) as QtiWorkspace;
  } catch (error) {
    console.error(`ワークスペース ${id} の取得に失敗:`, error);
    return null;
  }
};

export const writeWorkspace = async (
  workspace: QtiWorkspace
): Promise<void> => {
  ensureDataDir();
  const metaPath = getWorkspaceMetaPath(workspace.id);
  await withFileLock(metaPath, async () => {
    await atomicWriteJson(metaPath, workspace);
  });
};

export const listWorkspaces = async (): Promise<QtiWorkspaceSummary[]> => {
  ensureDataDir();
  try {
    const entries = await fs.promises.readdir(DATA_DIR, {
      withFileTypes: true,
    });
    const summaries: QtiWorkspaceSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metaPath = path.join(DATA_DIR, entry.name, WORKSPACE_META);
      if (!fs.existsSync(metaPath)) continue;
      try {
        const content = await fs.promises.readFile(metaPath, "utf-8");
        const workspace = JSON.parse(content) as QtiWorkspace;
        summaries.push({
          id: workspace.id,
          name: workspace.name,
          description: workspace.description,
          createdAt: workspace.createdAt,
          updatedAt: workspace.updatedAt,
          itemCount: workspace.itemCount,
          resultCount: workspace.resultCount,
        });
      } catch (error) {
        console.error(`workspace.json 読み込み失敗: ${metaPath}`, error);
      }
    }
    return summaries.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  } catch (error) {
    console.error("ワークスペース一覧の取得に失敗:", error);
    return [];
  }
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
  ensureDataDir();
  try {
    await fs.promises.rm(getWorkspaceDir(id), { recursive: true, force: true });
    return true;
  } catch (error) {
    console.error(`ワークスペース ${id} の削除に失敗:`, error);
    return false;
  }
};

export const updateResultXml = async (
  id: string,
  resultFile: string,
  xml: string
): Promise<void> => {
  const resultPath = path.join(getWorkspaceDir(id), "results", resultFile);
  await withFileLock(resultPath, async () => {
    await atomicWriteFile(resultPath, xml);
  });
};

export const ensureWorkspaceSubdirs = async (id: string) => {
  ensureDataDir();
  const workspaceDir = getWorkspaceDir(id);
  await fs.promises.mkdir(path.join(workspaceDir, "assessment"), {
    recursive: true,
  });
  await fs.promises.mkdir(path.join(workspaceDir, "items"), {
    recursive: true,
  });
  await fs.promises.mkdir(path.join(workspaceDir, "results"), {
    recursive: true,
  });
  return workspaceDir;
};

export const sanitizeFileName = (name: string) =>
  name
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

export const sanitizeRelativePath = (value: string) => {
  const replaced = value.replace(/\\/g, "/").trim();
  const withoutDrive = replaced.replace(/^[A-Za-z]:/, "");
  const stripped = withoutDrive.replace(/^\/+/, "");
  const normalized = path.posix.normalize(stripped);
  if (!normalized || normalized === ".") {
    throw new Error("相対パスが空です");
  }
  if (normalized.startsWith("..") || normalized.includes("/..")) {
    throw new Error(`不正な相対パスです: ${value}`);
  }
  return normalized;
};
