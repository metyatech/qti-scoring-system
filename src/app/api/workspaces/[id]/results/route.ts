import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { QtiResultUpdateRequest } from '@/types/qti';
import { readWorkspace, getWorkspaceDir, updateResultXml } from '@/lib/workspace';
import { applyQtiResultsUpdate } from '@/lib/qtiTools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body: QtiResultUpdateRequest = await request.json();

    if (!body || !body.resultFile || !Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: '不正な更新データです' }, { status: 400 });
    }

    const workspace = await readWorkspace(id);
    if (!workspace) {
      return NextResponse.json({ error: 'ワークスペースが見つかりません' }, { status: 404 });
    }

    const workspaceDir = getWorkspaceDir(id);
    const resultPath = path.join(workspaceDir, 'results', body.resultFile);
    if (!fs.existsSync(resultPath)) {
      return NextResponse.json({ error: '結果ファイルが見つかりません' }, { status: 404 });
    }

    const assessmentTestPath = path.join(workspaceDir, 'assessment', workspace.assessmentTestFile);
    if (!workspace.assessmentTestFile || !fs.existsSync(assessmentTestPath)) {
      return NextResponse.json({ error: 'assessmentTest が見つかりません' }, { status: 400 });
    }

    const scoringInput = { items: body.items };
    const tmpDir = path.join(workspaceDir, 'tmp');
    await fs.promises.mkdir(tmpDir, { recursive: true });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tmpPath = path.join(tmpDir, `scoring-${stamp}.json`);
    const tmpResultsPath = path.join(tmpDir, `results-${stamp}.xml`);
    await fs.promises.writeFile(tmpPath, JSON.stringify(scoringInput, null, 2), 'utf-8');
    await fs.promises.copyFile(resultPath, tmpResultsPath);

    try {
      const updatedXml = await applyQtiResultsUpdate({
        resultsPath: tmpResultsPath,
        assessmentTestPath,
        scoringPath: tmpPath,
        preserveMet: body.preserveMet,
      });
      await updateResultXml(id, body.resultFile, updatedXml);
    } finally {
      try { await fs.promises.unlink(tmpPath); } catch { /* ignore */ }
      try { await fs.promises.unlink(tmpResultsPath); } catch { /* ignore */ }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('結果更新エラー:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'サーバーエラー' }, { status: 500 });
  }
}
