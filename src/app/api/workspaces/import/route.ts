import { NextRequest, NextResponse } from 'next/server'
import { importWorkspaceArchive, WorkspaceImportError } from '@/lib/workspaceTransfer'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData()
    const archive = form.get('archive')
    if (!(archive instanceof File)) {
      return NextResponse.json({ error: 'インポートファイルが必要です' }, { status: 400 })
    }

    const mode = String(form.get('mode') ?? 'reject')
    const overwrite = mode === 'overwrite'
    const buffer = Buffer.from(await archive.arrayBuffer())
    const result = await importWorkspaceArchive(buffer, { overwrite })

    return NextResponse.json({
      success: true,
      importedCount: result.workspaceIds.length,
      workspaceIds: result.workspaceIds,
    })
  } catch (error) {
    if (error instanceof WorkspaceImportError) {
      const status = error.code === 'conflict' ? 409 : 400
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    console.error('ワークスペースインポートエラー:', error)
    return NextResponse.json({ error: 'ワークスペースのインポートに失敗しました' }, { status: 500 })
  }
}
