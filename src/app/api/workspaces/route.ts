import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { ensureWorkspaceSubdirs, sanitizeFileName, writeWorkspace, listWorkspaces } from '@/lib/workspace';
import { validateMappingConsistency } from '@/lib/qtiValidation';
import { QtiWorkspace } from '@/types/qti';

export const runtime = 'nodejs';

// ワークスペース作成
export async function POST(request: NextRequest) {
    try {
        const form = await request.formData();
        const name = String(form.get('name') ?? '').trim();
        const description = String(form.get('description') ?? '').trim();
        const items = form.getAll('items').filter((v): v is File => v instanceof File);
        const results = form.getAll('results').filter((v): v is File => v instanceof File);
        const mapping = form.get('mapping');

        if (!name || items.length === 0 || results.length === 0 || !(mapping instanceof File)) {
            return NextResponse.json({ error: '必要なデータが不足しています' }, { status: 400 });
        }

        const itemBuffers = await Promise.all(items.map(async (file) => ({
            file,
            safeName: sanitizeFileName(file.name || 'item.xml'),
            buffer: Buffer.from(await file.arrayBuffer()),
        })));
        const resultBuffers = await Promise.all(results.map(async (file) => ({
            file,
            safeName: sanitizeFileName(file.name || 'results.xml'),
            buffer: Buffer.from(await file.arrayBuffer()),
        })));
        const mappingName = sanitizeFileName(mapping.name || 'mapping.csv');
        const mappingBuffer = Buffer.from(await mapping.arrayBuffer());

        const validation = validateMappingConsistency(
            itemBuffers.map((entry) => entry.buffer.toString('utf-8')),
            resultBuffers.map((entry) => entry.buffer.toString('utf-8')),
            mappingBuffer.toString('utf-8')
        );
        if (!validation.isValid) {
            return NextResponse.json(
                { error: validation.errors.join('\n') },
                { status: 400 }
            );
        }

        const workspaceId = generateWorkspaceId();
        const workspaceDir = await ensureWorkspaceSubdirs(workspaceId);

        const itemFiles: string[] = [];
        for (const entry of itemBuffers) {
            const target = path.join(workspaceDir, 'items', entry.safeName);
            await fs.promises.writeFile(target, entry.buffer);
            itemFiles.push(entry.safeName);
        }

        const resultFiles: string[] = [];
        for (const entry of resultBuffers) {
            const target = path.join(workspaceDir, 'results', entry.safeName);
            await fs.promises.writeFile(target, entry.buffer);
            resultFiles.push(entry.safeName);
        }

        const mappingTarget = path.join(workspaceDir, mappingName);
        await fs.promises.writeFile(mappingTarget, mappingBuffer);

        const now = new Date().toISOString();
        const workspace: QtiWorkspace = {
            id: workspaceId,
            name,
            description: description || undefined,
            createdAt: now,
            updatedAt: now,
            itemFiles,
            resultFiles,
            mappingFile: mappingName,
            itemCount: itemFiles.length,
            resultCount: resultFiles.length,
        };

        await writeWorkspace(workspace);

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
