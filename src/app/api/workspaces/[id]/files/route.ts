import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getWorkspaceDir, sanitizeFileName } from '@/lib/workspace';
import { buildContentDisposition } from '@/lib/httpHeaders';

export const runtime = 'nodejs';

const resolveFilePath = (id: string, kind: string, name: string) => {
  const safeName = sanitizeFileName(name);
  const baseDir = getWorkspaceDir(id);
  if (kind === 'items') return path.join(baseDir, 'items', safeName);
  if (kind === 'results') return path.join(baseDir, 'results', safeName);
  if (kind === 'mapping') return path.join(baseDir, safeName);
  return null;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const kind = searchParams.get('kind');
    const name = searchParams.get('name');
    if (!kind || !name) {
      return NextResponse.json({ error: 'kind と name が必要です' }, { status: 400 });
    }

    const filePath = resolveFilePath(id, kind, name);
    if (!filePath || !fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'ファイルが見つかりません' }, { status: 404 });
    }

    const content = await fs.promises.readFile(filePath, 'utf-8');
    const contentType =
      kind === 'mapping' ? 'text/csv; charset=utf-8' : 'application/xml; charset=utf-8';
    const fallbackName = sanitizeFileName(name);
    return new NextResponse(content, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': buildContentDisposition(name, fallbackName),
      },
    });
  } catch (error) {
    console.error('ファイル取得エラー:', error);
    return NextResponse.json({ error: 'ファイルの取得に失敗しました' }, { status: 500 });
  }
}
