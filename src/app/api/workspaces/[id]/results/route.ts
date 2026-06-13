import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { QtiResultUpdateRequest } from '@/types/qti';
import {
  readWorkspace,
  resolveWorkspaceDir,
  resolveResultPath,
  sanitizeResultFileName,
  updateResultXml,
} from '@/lib/workspace';
import { applyQtiResultsUpdate } from '@/lib/qtiTools';
import { parseAssessmentTestXml } from '@/utils/qtiParsing';
import { buildResultUpdateResponse } from './response';

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

    const workspaceDir = await resolveWorkspaceDir(id);
    if (!workspaceDir) {
      return NextResponse.json({ error: 'ワークスペースが見つかりません' }, { status: 404 });
    }

    // Reject path traversal / drive letters / absolute paths up front so the
    // requested resultFile can never escape the results/ directory.
    let safeResultName: string;
    try {
      safeResultName = sanitizeResultFileName(body.resultFile);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'resultFile が不正です' },
        { status: 400 }
      );
    }
    if (!workspace.resultFiles.includes(safeResultName)) {
      return NextResponse.json(
        { error: `resultFile がこのワークスペースに登録されていません: ${body.resultFile}` },
        { status: 400 }
      );
    }
    const resultPath = resolveResultPath(workspaceDir, safeResultName);
    let resultStat: fs.Stats;
    try {
      resultStat = await fs.promises.stat(resultPath);
    } catch {
      return NextResponse.json({ error: '結果ファイルが見つかりません' }, { status: 404 });
    }
    if (!resultStat.isFile()) {
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

      // Validate the update BEFORE touching the production file. The
      // assessment-test XML is needed so the helper can remap Results-side
      // itemResult identifiers onto the assessment item identifiers via the
      // assessment-test item refs. We pass `updatedXml` (the apply output)
      // directly — it is exactly what we are about to persist, so no re-read
      // is required. Any throw here (unparseable assessment-test, unmapped
      // itemResult, ambiguous remap, unknown requested identifier, or
      // missing itemResult) propagates to the outer catch and becomes a 500,
      // and crucially the production file is still untouched because
      // updateResultXml has not run yet — so the frontend's optimistic
      // rollback matches the on-disk state.
      const assessmentTestXml = await fs.promises.readFile(assessmentTestPath, 'utf-8');
      const assessmentTestRefs = parseAssessmentTestXml(assessmentTestXml);
      const responseBody = buildResultUpdateResponse({
        updatedXml,
        fileName: safeResultName,
        requestedIdentifiers: body.items.map((item) => item.identifier),
        assessmentTestRefs,
      });

      // Validation succeeded — only now persist the new XML to production.
      await updateResultXml(workspaceDir, safeResultName, updatedXml);
      return NextResponse.json(responseBody);
    } finally {
      try { await fs.promises.unlink(tmpPath); } catch { /* ignore */ }
      try { await fs.promises.unlink(tmpResultsPath); } catch { /* ignore */ }
    }
  } catch (error) {
    console.error('結果更新エラー:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'サーバーエラー' }, { status: 500 });
  }
}
