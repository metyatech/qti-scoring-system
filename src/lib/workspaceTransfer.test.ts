import fs from 'fs'
import path from 'path'
import os from 'os'
import JSZip from 'jszip'
import { describe, it, expect } from 'vitest'
import {
  createWorkspaceExportZip,
  importWorkspaceArchive,
  WorkspaceImportError,
} from '@/lib/workspaceTransfer'

const createWorkspaceFixture = async (root: string, id: string) => {
  const workspaceDir = path.join(root, id)
  await fs.promises.mkdir(path.join(workspaceDir, 'assessment'), { recursive: true })
  await fs.promises.mkdir(path.join(workspaceDir, 'results'), { recursive: true })
  await fs.promises.writeFile(
    path.join(workspaceDir, 'workspace.json'),
    JSON.stringify(
      {
        id,
        name: 'Test Workspace',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        itemFiles: ['items/item-1.qti.xml'],
        assessmentTestFile: 'assessment-test.qti.xml',
        resultFiles: ['result-1.xml'],
        itemCount: 1,
        resultCount: 1,
      },
      null,
      2,
    ),
  )
  await fs.promises.writeFile(
    path.join(workspaceDir, 'assessment', 'assessment-test.qti.xml'),
    '<qti-assessment-test/>',
  )
  await fs.promises.writeFile(
    path.join(workspaceDir, 'results', 'result-1.xml'),
    '<assessmentResult/>',
  )
}

describe('workspace transfer', () => {
  it('exports and imports workspace data', async () => {
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'workspace-export-'))
    const exportRoot = path.join(tempRoot, 'export')
    const importRoot = path.join(tempRoot, 'import')
    await fs.promises.mkdir(exportRoot, { recursive: true })
    await fs.promises.mkdir(importRoot, { recursive: true })

    await createWorkspaceFixture(exportRoot, 'ws_test')
    const buffer = await createWorkspaceExportZip('ws_test', exportRoot)

    const result = await importWorkspaceArchive(buffer, {
      overwrite: false,
      workspacesRoot: importRoot,
    })
    expect(result.workspaceIds).toEqual(['ws_test'])

    const importedJson = await fs.promises.readFile(
      path.join(importRoot, 'ws_test', 'workspace.json'),
      'utf-8',
    )
    const imported = JSON.parse(importedJson) as { name?: string }
    expect(imported.name).toBe('Test Workspace')

    const assessment = await fs.promises.readFile(
      path.join(importRoot, 'ws_test', 'assessment', 'assessment-test.qti.xml'),
      'utf-8',
    )
    expect(assessment).toContain('qti-assessment-test')
  })

  it('rejects unknown entries in archive', async () => {
    const zip = new JSZip()
    zip.file('random.txt', 'oops')
    const buffer = await zip.generateAsync({ type: 'nodebuffer' })

    await expect(
      importWorkspaceArchive(buffer, {
        overwrite: false,
        workspacesRoot: path.join(os.tmpdir(), 'import-invalid'),
      }),
    ).rejects.toBeInstanceOf(WorkspaceImportError)
  })

  it('fails on conflicts when overwrite is false', async () => {
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'workspace-conflict-'))
    const exportRoot = path.join(tempRoot, 'export')
    const importRoot = path.join(tempRoot, 'import')
    await fs.promises.mkdir(exportRoot, { recursive: true })
    await fs.promises.mkdir(importRoot, { recursive: true })

    await createWorkspaceFixture(exportRoot, 'ws_conflict')
    await createWorkspaceFixture(importRoot, 'ws_conflict')

    const buffer = await createWorkspaceExportZip('ws_conflict', exportRoot)

    await expect(
      importWorkspaceArchive(buffer, { overwrite: false, workspacesRoot: importRoot }),
    ).rejects.toBeInstanceOf(WorkspaceImportError)
  })

  it('rejects multiple workspaces in archive', async () => {
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'workspace-multi-'))
    const exportRoot = path.join(tempRoot, 'export')
    await fs.promises.mkdir(exportRoot, { recursive: true })
    await createWorkspaceFixture(exportRoot, 'ws_one')
    await createWorkspaceFixture(exportRoot, 'ws_two')

    const firstBuffer = await createWorkspaceExportZip('ws_one', exportRoot)
    const firstZip = await JSZip.loadAsync(firstBuffer)
    const secondBuffer = await createWorkspaceExportZip('ws_two', exportRoot)
    const secondZip = await JSZip.loadAsync(secondBuffer)

    const combined = new JSZip()
    for (const [name, file] of Object.entries(firstZip.files)) {
      if (file.dir) continue
      const content = await file.async('nodebuffer')
      combined.file(name, content)
    }
    for (const [name, file] of Object.entries(secondZip.files)) {
      if (file.dir) continue
      if (name === 'workspace-export.json') continue
      const content = await file.async('nodebuffer')
      combined.file(name, content)
    }

    const multiBuffer = await combined.generateAsync({ type: 'nodebuffer' })
    await expect(
      importWorkspaceArchive(multiBuffer, {
        overwrite: false,
        workspacesRoot: path.join(tempRoot, 'import'),
      }),
    ).rejects.toBeInstanceOf(WorkspaceImportError)
  })
})
