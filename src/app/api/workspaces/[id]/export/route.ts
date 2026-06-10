import { NextResponse } from 'next/server';
import { createWorkspaceExportZip } from '@/lib/workspaceTransfer';
import { buildContentDisposition } from '@/lib/httpHeaders';
import { readWorkspace, resolveWorkspaceDir, sanitizeFileName } from '@/lib/workspace';

export const runtime = 'nodejs';

const buildExportFileName = (workspaceName: string) => {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const safeName = sanitizeFileName(workspaceName);
  return `${safeName || 'workspace'}-${timestamp}.zip`;
};

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: workspaceId } = await context.params;
    const workspace = await readWorkspace(workspaceId);
    if (!workspace) {
      return NextResponse.json({ error: 'ワークスペースが見つかりません' }, { status: 404 });
    }
    const workspaceDir = await resolveWorkspaceDir(workspaceId);
    if (!workspaceDir) {
      return NextResponse.json({ error: 'ワークスペースが見つかりません' }, { status: 404 });
    }
    const buffer = await createWorkspaceExportZip(workspaceId, workspaceDir);
    const body = new Uint8Array(buffer);
    const fileName = buildExportFileName(workspace.name);
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': buildContentDisposition(fileName, 'workspace-export.zip'),
      },
    });
  } catch (error) {
    console.error('ワークスペースエクスポートエラー:', error);
    return NextResponse.json(
      { error: 'ワークスペースのエクスポートに失敗しました' },
      { status: 500 }
    );
  }
}
