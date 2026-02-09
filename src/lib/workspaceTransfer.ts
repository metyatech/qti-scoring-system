import fs from 'fs'
import path from 'path'
import JSZip from 'jszip'
import { getWorkspacesRoot } from '@/lib/workspace'

const EXPORT_ROOT = 'workspaces'
const EXPORT_MANIFEST = 'workspace-export.json'
const MANIFEST_VERSION = 1

export class WorkspaceImportError extends Error {
  code?: 'invalid' | 'conflict'
  constructor(message: string, code: 'invalid' | 'conflict' = 'invalid') {
    super(message)
    this.name = 'WorkspaceImportError'
    this.code = code
  }
}

type ExportWorkspaceInfo = {
  id: string
  name?: string
  updatedAt?: string
}

type ExportManifest = {
  version: number
  createdAt: string
  workspaceCount: number
  workspaces: ExportWorkspaceInfo[]
}

type ImportOptions = {
  overwrite: boolean
  workspacesRoot?: string
}

type ImportResult = {
  manifest: ExportManifest | null
  workspaceIds: string[]
}

const toSafePosixPath = (value: string) => value.replace(/\\/g, '/')

const normalizeZipPath = (value: string) => {
  const normalized = path.posix.normalize(value)
  if (!normalized || normalized === '.') {
    throw new WorkspaceImportError('アーカイブ内のパスが空です')
  }
  if (normalized.startsWith('..') || normalized.includes('/..')) {
    throw new WorkspaceImportError(`アーカイブ内のパスが不正です: ${value}`)
  }
  return normalized
}

const validateWorkspaceId = (value: string) => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new WorkspaceImportError(`ワークスペースIDが不正です: ${value}`)
  }
}

const ensureDir = async (dirPath: string) => {
  await fs.promises.mkdir(dirPath, { recursive: true })
}

const addDirToZip = (zip: JSZip, sourceDir: string, zipPrefix: string) => {
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.endsWith('.tmp') || entry.name.endsWith('.bak')) {
      continue
    }
    const entryPath = path.join(sourceDir, entry.name)
    const targetPath = path.posix.join(zipPrefix, entry.name)
    if (entry.isDirectory()) {
      addDirToZip(zip, entryPath, targetPath)
      continue
    }
    if (entry.isFile()) {
      const content = fs.readFileSync(entryPath)
      zip.file(targetPath, content)
    }
  }
}

const buildManifest = async (
  workspaceId: string,
  workspacesRoot: string,
): Promise<ExportManifest> => {
  const metaPath = path.join(workspacesRoot, workspaceId, 'workspace.json')
  const info: ExportWorkspaceInfo = { id: workspaceId }
  try {
    const content = await fs.promises.readFile(metaPath, 'utf-8')
    const parsed = JSON.parse(content) as { id?: string; name?: string; updatedAt?: string }
    info.id = parsed.id ?? workspaceId
    info.name = parsed.name
    info.updatedAt = parsed.updatedAt
  } catch {
    // ignore missing or invalid metadata
  }
  return {
    version: MANIFEST_VERSION,
    createdAt: new Date().toISOString(),
    workspaceCount: 1,
    workspaces: [info],
  }
}

export const createWorkspaceExportZip = async (
  workspaceId: string,
  workspacesRoot = getWorkspacesRoot(),
): Promise<Buffer> => {
  await ensureDir(workspacesRoot)
  validateWorkspaceId(workspaceId)
  const workspaceDir = path.join(workspacesRoot, workspaceId)
  if (!fs.existsSync(workspaceDir)) {
    throw new WorkspaceImportError(`ワークスペースが見つかりません: ${workspaceId}`)
  }
  const zip = new JSZip()
  addDirToZip(zip, workspaceDir, path.posix.join(EXPORT_ROOT, workspaceId))
  const manifest = await buildManifest(workspaceId, workspacesRoot)
  zip.file(EXPORT_MANIFEST, JSON.stringify(manifest, null, 2))
  return await zip.generateAsync({ type: 'nodebuffer' })
}

export const importWorkspaceArchive = async (
  buffer: Buffer,
  options: ImportOptions,
): Promise<ImportResult> => {
  const workspacesRoot = options.workspacesRoot ?? getWorkspacesRoot()
  await ensureDir(workspacesRoot)

  const zip = await JSZip.loadAsync(buffer)
  const entries = Object.values(zip.files)

  const workspaces = new Map<string, Array<{ relativePath: string; entry: JSZip.JSZipObject }>>()
  const workspaceMeta = new Map<string, { id: string }>()
  let manifest: ExportManifest | null = null

  for (const entry of entries) {
    if (entry.dir) continue
    const name = toSafePosixPath(entry.name)
    if (name === EXPORT_MANIFEST) {
      const content = await entry.async('string')
      try {
        const parsed = JSON.parse(content) as ExportManifest
        if (parsed.version !== MANIFEST_VERSION) {
          throw new WorkspaceImportError(`対応していないエクスポート形式です: v${parsed.version}`)
        }
        manifest = parsed
      } catch (error) {
        if (error instanceof WorkspaceImportError) throw error
        throw new WorkspaceImportError('エクスポート情報の読み込みに失敗しました')
      }
      continue
    }

    if (!name.startsWith(`${EXPORT_ROOT}/`)) {
      throw new WorkspaceImportError(`不明なアーカイブエントリです: ${name}`)
    }

    const trimmed = name.slice(EXPORT_ROOT.length + 1)
    const normalized = normalizeZipPath(trimmed)
    const [workspaceId, ...restParts] = normalized.split('/')
    if (!workspaceId || restParts.length === 0) {
      throw new WorkspaceImportError(`ワークスペースデータが不正です: ${name}`)
    }
    validateWorkspaceId(workspaceId)
    const relativePath = normalizeZipPath(restParts.join('/'))

    if (!workspaces.has(workspaceId)) {
      workspaces.set(workspaceId, [])
    }
    workspaces.get(workspaceId)!.push({ relativePath, entry })

    if (relativePath === 'workspace.json') {
      const metaContent = await entry.async('string')
      try {
        const parsed = JSON.parse(metaContent) as { id?: string }
        if (!parsed.id || parsed.id !== workspaceId) {
          throw new WorkspaceImportError('workspace.json のIDが一致しません')
        }
        workspaceMeta.set(workspaceId, { id: parsed.id })
      } catch (error) {
        if (error instanceof WorkspaceImportError) throw error
        throw new WorkspaceImportError(`workspace.json の解析に失敗しました: ${workspaceId}`)
      }
    }
  }

  if (workspaces.size === 0) {
    throw new WorkspaceImportError('インポート対象のワークスペースが見つかりません')
  }
  if (workspaces.size > 1) {
    throw new WorkspaceImportError('複数ワークスペースのインポートには対応していません')
  }
  for (const workspaceId of workspaces.keys()) {
    if (!workspaceMeta.has(workspaceId)) {
      throw new WorkspaceImportError(`workspace.json が見つかりません: ${workspaceId}`)
    }
  }

  if (!options.overwrite) {
    const conflicts = Array.from(workspaces.keys()).filter((id) =>
      fs.existsSync(path.join(workspacesRoot, id)),
    )
    if (conflicts.length > 0) {
      throw new WorkspaceImportError(
        `既存ワークスペースと競合しています: ${conflicts.join(', ')}`,
        'conflict',
      )
    }
  }

  const tmpRoot = `${workspacesRoot}.import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await ensureDir(tmpRoot)

  try {
    for (const [workspaceId, files] of workspaces) {
      const workspaceTmp = path.join(tmpRoot, workspaceId)
      await ensureDir(workspaceTmp)
      for (const file of files) {
        const targetPath = path.join(workspaceTmp, ...file.relativePath.split('/'))
        await ensureDir(path.dirname(targetPath))
        const content = await file.entry.async('nodebuffer')
        await fs.promises.writeFile(targetPath, content)
      }
    }

    for (const workspaceId of workspaces.keys()) {
      const targetDir = path.join(workspacesRoot, workspaceId)
      if (options.overwrite && fs.existsSync(targetDir)) {
        await fs.promises.rm(targetDir, { recursive: true, force: true })
      }
      await fs.promises.rename(path.join(tmpRoot, workspaceId), targetDir)
    }
  } finally {
    await fs.promises.rm(tmpRoot, { recursive: true, force: true })
  }

  return {
    manifest,
    workspaceIds: Array.from(workspaces.keys()),
  }
}
