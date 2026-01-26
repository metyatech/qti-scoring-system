import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { readWorkspace, getWorkspaceDir, sanitizeFileName } from '@/lib/workspace';
import { buildContentDisposition } from '@/lib/httpHeaders';
import { generateCsvReport } from '@/lib/qtiReporter';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const workspace = await readWorkspace(id);
    if (!workspace) {
      return NextResponse.json({ error: 'ワークスペースが見つかりません' }, { status: 404 });
    }
    if (!workspace.assessmentTestFile) {
      return NextResponse.json({ error: 'assessmentTest が見つかりません' }, { status: 400 });
    }

    const workspaceDir = getWorkspaceDir(id);
    const assessmentTestPath = path.join(workspaceDir, 'assessment', workspace.assessmentTestFile);
    if (!fs.existsSync(assessmentTestPath)) {
      return NextResponse.json({ error: 'assessmentTest が見つかりません' }, { status: 400 });
    }

    const resultPaths = workspace.resultFiles
      .map((file) => path.join(workspaceDir, 'results', file))
      .filter((filePath) => fs.existsSync(filePath));
    if (resultPaths.length === 0) {
      return NextResponse.json({ error: '結果ファイルが見つかりません' }, { status: 404 });
    }

    const csv = await generateCsvReport({
      assessmentTestPath,
      assessmentResultPaths: resultPaths,
    });
    const safeName = sanitizeFileName(`${workspace.name} report.csv`);

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': buildContentDisposition('report.csv', safeName),
      },
    });
  } catch (error) {
    console.error('CSV 生成エラー:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'CSV の生成に失敗しました' },
      { status: 500 }
    );
  }
}
