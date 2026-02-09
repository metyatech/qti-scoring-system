import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { readWorkspace, getWorkspaceDir, sanitizeFileName } from '@/lib/workspace'
import { buildContentDisposition } from '@/lib/httpHeaders'
import { generateReportOutput } from '@/lib/qtiReporter'
import { createReportZip } from '@/lib/reportZip'

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const workspace = await readWorkspace(id)
    if (!workspace) {
      return NextResponse.json({ error: 'ワークスペースが見つかりません' }, { status: 404 })
    }
    if (!workspace.assessmentTestFile) {
      return NextResponse.json({ error: 'assessmentTest が見つかりません' }, { status: 400 })
    }

    const workspaceDir = getWorkspaceDir(id)
    const assessmentTestPath = path.join(workspaceDir, 'assessment', workspace.assessmentTestFile)
    if (!fs.existsSync(assessmentTestPath)) {
      return NextResponse.json({ error: 'assessmentTest が見つかりません' }, { status: 400 })
    }

    const results = workspace.resultFiles
      .map((file) => ({
        path: path.join(workspaceDir, 'results', file),
        name: file,
      }))
      .filter((entry) => fs.existsSync(entry.path))
    if (results.length === 0) {
      return NextResponse.json({ error: '結果ファイルが見つかりません' }, { status: 404 })
    }

    const reportOutput = await generateReportOutput({
      assessmentTestPath,
      assessmentResultPaths: results.map((entry) => entry.path),
    })
    try {
      const zipBuffer = await createReportZip({
        reportDir: reportOutput.outputDir,
        results,
      })
      const safeName = sanitizeFileName(`${workspace.name} report.zip`)
      const zipBody = new Uint8Array(zipBuffer)
      return new NextResponse(zipBody, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': buildContentDisposition('report.zip', safeName),
        },
      })
    } finally {
      await reportOutput.cleanup()
    }
  } catch (error) {
    console.error('レポート ZIP 生成エラー:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'レポート ZIP の生成に失敗しました' },
      { status: 500 },
    )
  }
}
