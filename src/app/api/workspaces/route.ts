import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import {
  ensureWorkspaceSubdirsAt,
  getWorkspaceIndexConfig,
  getWorkspaceMode,
  getWorkspacesRoot,
  sanitizeFileName,
  sanitizeRelativePath,
  validateWorkspaceDirWithinRepo,
  writeWorkspaceMetaAt,
  listWorkspaces,
} from '@/lib/workspace';
import { validateAssessmentConsistency } from '@/lib/qtiValidation';
import { normalizeUploadPath } from '@/utils/uploadName';
import { QtiWorkspace } from '@/types/qti';

export const runtime = 'nodejs';

const detectSharedRootSegment = (paths: string[]): string | null => {
  if (paths.length === 0) return null;
  if (!paths.every((p) => p.includes('/'))) return null;
  const first = paths[0].split('/')[0];
  if (!first) return null;
  return paths.every((p) => p.startsWith(`${first}/`)) ? first : null;
};

const stripSharedRootSegment = (value: string, rootSegment: string | null) => {
  if (!rootSegment) return value;
  return value.startsWith(`${rootSegment}/`) ? value.slice(rootSegment.length + 1) : value;
};

// ワークスペース作成
export async function POST(request: NextRequest) {
    try {
        const form = await request.formData();
        const name = String(form.get('name') ?? '').trim();
        const description = String(form.get('description') ?? '').trim();
        const assessmentInputs = form.getAll('assessmentFiles').filter((v): v is File => v instanceof File);
        const results = form.getAll('results').filter((v): v is File => v instanceof File);

        if (!name || assessmentInputs.length === 0 || results.length === 0) {
            return NextResponse.json({ error: '必要なデータが不足しています' }, { status: 400 });
        }

        const assessmentRawPaths = assessmentInputs.map((file) =>
            normalizeUploadPath(file.name || 'assessment.xml')
        );
        const sharedRoot = detectSharedRootSegment(assessmentRawPaths);

        const assessmentEntries: Array<{ safePath: string; buffer: Buffer }> = [];
        const assessmentBuffers = new Map<string, Buffer>();
        for (let index = 0; index < assessmentInputs.length; index += 1) {
            const file = assessmentInputs[index];
            const rawPath = assessmentRawPaths[index];
            const stripped = stripSharedRootSegment(rawPath, sharedRoot);
            let safePath: string;
            try {
                safePath = sanitizeRelativePath(stripped);
            } catch (error) {
                return NextResponse.json(
                    { error: error instanceof Error ? error.message : 'assessmentFiles のパスが不正です' },
                    { status: 400 }
                );
            }
            if (assessmentBuffers.has(safePath)) {
                return NextResponse.json(
                    { error: `assessmentFiles に重複したパスがあります: ${safePath}` },
                    { status: 400 }
                );
            }
            const buffer = Buffer.from(await file.arrayBuffer());
            assessmentBuffers.set(safePath, buffer);
            assessmentEntries.push({ safePath, buffer });
        }

        const assessmentTestEntries = assessmentEntries.filter(
            (entry) => path.posix.basename(entry.safePath) === 'assessment-test.qti.xml'
        );
        if (assessmentTestEntries.length !== 1) {
            return NextResponse.json(
                { error: 'assessment-test.qti.xml を1つだけ含めてください' },
                { status: 400 }
            );
        }
        const assessmentTestEntry = assessmentTestEntries[0];

        const resultEntries: Array<{ safeName: string; buffer: Buffer }> = [];
        const resultNameSet = new Set<string>();
        for (const file of results) {
            const baseName = path.basename(file.name || 'results.xml');
            const safeName = sanitizeFileName(baseName);
            if (resultNameSet.has(safeName)) {
                return NextResponse.json(
                    { error: `results に重複したファイル名があります: ${safeName}` },
                    { status: 400 }
                );
            }
            const buffer = Buffer.from(await file.arrayBuffer());
            resultNameSet.add(safeName);
            resultEntries.push({ safeName, buffer });
        }

        const assessmentXmls = new Map<string, string>();
        for (const entry of assessmentEntries) {
            assessmentXmls.set(entry.safePath, entry.buffer.toString('utf-8'));
        }

        const validation = validateAssessmentConsistency({
            assessmentTestPath: assessmentTestEntry.safePath,
            assessmentTestXml: assessmentTestEntry.buffer.toString('utf-8'),
            assessmentFiles: assessmentXmls,
            resultFiles: resultEntries.map((entry) => ({
                name: entry.safeName,
                xml: entry.buffer.toString('utf-8'),
            })),
        });
        if (!validation.isValid) {
            return NextResponse.json(
                { error: validation.errors.join('\n') },
                { status: 400 }
            );
        }
        const itemFiles = validation.itemRefs?.map((ref) => ref.resolvedHref) ?? [];

        let workspaceId: string;
        let workspaceDir: string;
        let assessmentDirRel: string | undefined;

        if (getWorkspaceMode() === 'index') {
            const indexConfig = getWorkspaceIndexConfig()!;
            workspaceId = String(form.get('workspaceId') ?? '').trim();
            const workspaceDirInput = String(form.get('workspaceDir') ?? '').trim();
            assessmentDirRel = String(form.get('assessmentDir') ?? '').trim() || undefined;
            if (!workspaceId || !workspaceDirInput) {
                return NextResponse.json(
                    { error: 'index モードでは workspaceId と workspaceDir が必要です' },
                    { status: 400 }
                );
            }
            if (!/^[A-Za-z0-9_-]+$/.test(workspaceId)) {
                return NextResponse.json(
                    { error: `workspaceId が不正です: ${workspaceId}` },
                    { status: 400 }
                );
            }
            try {
                workspaceDir = validateWorkspaceDirWithinRepo(indexConfig.repoRoot, workspaceDirInput);
            } catch (error) {
                return NextResponse.json(
                    { error: error instanceof Error ? error.message : 'workspaceDir が不正です' },
                    { status: 400 }
                );
            }
            // Never overwrite an existing, possibly human-edited workspace.
            const existingMetaPath = path.join(workspaceDir, 'workspace.json');
            if (fs.existsSync(existingMetaPath)) {
                try {
                    const existing = JSON.parse(
                        await fs.promises.readFile(existingMetaPath, 'utf-8')
                    ) as QtiWorkspace;
                    return NextResponse.json({
                        success: true,
                        reused: true,
                        workspace: {
                            id: existing.id,
                            name: existing.name,
                            description: existing.description,
                            createdAt: existing.createdAt,
                            itemCount: existing.itemCount,
                            resultCount: existing.resultCount,
                        },
                    });
                } catch {
                    return NextResponse.json(
                        { error: `既存の workspace.json を読み取れません: ${existingMetaPath}` },
                        { status: 409 }
                    );
                }
            }
        } else {
            workspaceId = generateWorkspaceId();
            workspaceDir = path.join(getWorkspacesRoot(), workspaceId);
        }

        await ensureWorkspaceSubdirsAt(workspaceDir);

        for (const entry of assessmentEntries) {
            const target = path.join(workspaceDir, 'assessment', entry.safePath);
            await fs.promises.mkdir(path.dirname(target), { recursive: true });
            await fs.promises.writeFile(target, entry.buffer);
        }

        const resultFiles: string[] = [];
        for (const entry of resultEntries) {
            const target = path.join(workspaceDir, 'results', entry.safeName);
            await fs.promises.writeFile(target, entry.buffer);
            resultFiles.push(entry.safeName);
        }

        const now = new Date().toISOString();
        const workspace: QtiWorkspace = {
            id: workspaceId,
            name,
            description: description || undefined,
            createdAt: now,
            updatedAt: now,
            itemFiles,
            assessmentTestFile: assessmentTestEntry.safePath,
            resultFiles,
            itemCount: itemFiles.length,
            resultCount: resultFiles.length,
            ...(assessmentDirRel ? { assessmentDir: assessmentDirRel } : {}),
        };

        await writeWorkspaceMetaAt(workspaceDir, workspace);

        return NextResponse.json({
            success: true,
            workspace: {
                id: workspace.id,
                name: workspace.name,
                description: workspace.description,
                createdAt: workspace.createdAt,
                itemCount: workspace.itemCount,
                resultCount: workspace.resultCount,
            }
        });
    } catch (error) {
        console.error('ワークスペース作成エラー:', error);
        return NextResponse.json(
            { error: 'ワークスペースの作成に失敗しました' },
            { status: 500 }
        );
    }
}

// ワークスペース一覧取得
export async function GET() {
    try {
        const workspaces = await listWorkspaces();
        return NextResponse.json({
            success: true,
            workspaces
        });
    } catch (error) {
        console.error('ワークスペース一覧取得エラー:', error);
        return NextResponse.json(
            { error: 'ワークスペース一覧の取得に失敗しました' },
            { status: 500 }
        );
    }
}

const generateWorkspaceId = (): string => {
    const timestamp = Date.now().toString(36);
    const randomStr = Math.random().toString(36).substring(2, 8);
    return `ws_${timestamp}_${randomStr}`;
};
