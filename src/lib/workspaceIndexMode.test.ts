import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getWorkspaceMode,
  listWorkspaces,
  resolveWorkspaceDir,
  validateWorkspaceDirWithinRepo,
} from '@/lib/workspace';
import { QtiWorkspace } from '@/types/qti';

const POSIX = (p: string) => p.split(path.sep).join('/');

const makeWorkspace = (id: string, name: string): QtiWorkspace => ({
  id,
  name,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-02T00:00:00.000Z',
  itemFiles: ['items/q1.qti.xml'],
  assessmentTestFile: 'assessment-test.qti.xml',
  resultFiles: ['assessmentResult-1.xml'],
  itemCount: 1,
  resultCount: 1,
});

interface Fixture {
  repoRoot: string;
  indexPath: string;
}

const writeWorkspaceDir = async (repoRoot: string, relDir: string, workspace: QtiWorkspace) => {
  const absDir = path.join(repoRoot, relDir);
  await fs.promises.mkdir(path.join(absDir, 'assessment'), { recursive: true });
  await fs.promises.mkdir(path.join(absDir, 'results'), { recursive: true });
  await fs.promises.writeFile(
    path.join(absDir, 'workspace.json'),
    JSON.stringify(workspace, null, 2),
    'utf-8'
  );
};

const setupFixture = async (): Promise<Fixture> => {
  const repoRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qti-index-mode-'));
  const relA = 'courses/javascript/2026/1semester/exams/1midterm-exam/2regular/result/scoring-workspace';
  const relB = 'courses/programming/2026/exams/2final-exam/1regular/result/scoring-workspace';
  await writeWorkspaceDir(repoRoot, relA, makeWorkspace('exam_aaaa', 'Exam A'));
  await writeWorkspaceDir(repoRoot, relB, makeWorkspace('exam_bbbb', 'Exam B'));

  const index = {
    version: 1,
    generatedAt: '2026-06-10T00:00:00.000Z',
    workspaces: [
      { id: 'exam_aaaa', assessmentDir: path.posix.dirname(path.posix.dirname(relA)), workspaceDir: relA, name: 'Exam A', updatedAt: '2026-06-02T00:00:00.000Z' },
      { id: 'exam_bbbb', assessmentDir: path.posix.dirname(path.posix.dirname(relB)), workspaceDir: relB, name: 'Exam B', updatedAt: '2026-06-03T00:00:00.000Z' },
      // Stale entry: index references a workspace whose directory was removed.
      { id: 'exam_stale', workspaceDir: 'courses/x/exams/y/result/scoring-workspace', name: 'Stale' },
    ],
  };
  const indexDir = path.join(repoRoot, '.course-assessment');
  await fs.promises.mkdir(indexDir, { recursive: true });
  const indexPath = path.join(indexDir, 'scoring-workspace-index.json');
  await fs.promises.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');

  return { repoRoot, indexPath };
};

describe('workspace index mode', () => {
  let fixture: Fixture;
  const prevRepoRoot = process.env.QTI_SCORING_SYSTEM_REPO_ROOT;
  const prevIndex = process.env.QTI_SCORING_SYSTEM_WORKSPACE_INDEX;

  beforeEach(async () => {
    fixture = await setupFixture();
    process.env.QTI_SCORING_SYSTEM_REPO_ROOT = fixture.repoRoot;
    process.env.QTI_SCORING_SYSTEM_WORKSPACE_INDEX = fixture.indexPath;
  });

  afterEach(async () => {
    if (prevRepoRoot === undefined) delete process.env.QTI_SCORING_SYSTEM_REPO_ROOT;
    else process.env.QTI_SCORING_SYSTEM_REPO_ROOT = prevRepoRoot;
    if (prevIndex === undefined) delete process.env.QTI_SCORING_SYSTEM_WORKSPACE_INDEX;
    else process.env.QTI_SCORING_SYSTEM_WORKSPACE_INDEX = prevIndex;
    await fs.promises.rm(fixture.repoRoot, { recursive: true, force: true });
  });

  it('reports index mode when env vars are set', () => {
    expect(getWorkspaceMode()).toBe('index');
  });

  it('lists every valid workspace across exams and excludes stale entries', async () => {
    const summaries = await listWorkspaces();
    const ids = summaries.map((s) => s.id);
    expect(ids).toContain('exam_aaaa');
    expect(ids).toContain('exam_bbbb');
    expect(ids).not.toContain('exam_stale');
    expect(ids).toHaveLength(2);
  });

  it('resolves a workspace id to its on-disk directory', async () => {
    const dir = await resolveWorkspaceDir('exam_aaaa');
    expect(dir).not.toBeNull();
    expect(POSIX(path.relative(fixture.repoRoot, dir!))).toBe(
      'courses/javascript/2026/1semester/exams/1midterm-exam/2regular/result/scoring-workspace'
    );
    expect(fs.existsSync(path.join(dir!, 'workspace.json'))).toBe(true);
  });

  it('returns null for an unknown workspace id', async () => {
    expect(await resolveWorkspaceDir('exam_missing')).toBeNull();
  });

  it('reflects index edits without restart (read on every call)', async () => {
    const relC = 'courses/javascript/2026/exams/3quiz/1regular/result/scoring-workspace';
    await writeWorkspaceDir(fixture.repoRoot, relC, makeWorkspace('exam_cccc', 'Exam C'));
    const current = JSON.parse(await fs.promises.readFile(fixture.indexPath, 'utf-8')) as {
      workspaces: unknown[];
    };
    current.workspaces.push({ id: 'exam_cccc', workspaceDir: relC, name: 'Exam C' });
    await fs.promises.writeFile(fixture.indexPath, JSON.stringify(current, null, 2), 'utf-8');

    const dir = await resolveWorkspaceDir('exam_cccc');
    expect(dir).not.toBeNull();
  });
});

describe('validateWorkspaceDirWithinRepo', () => {
  const repoRoot = path.resolve(os.tmpdir(), 'fake-repo-root');

  it('accepts a canonical scoring-workspace path', () => {
    const result = validateWorkspaceDirWithinRepo(
      repoRoot,
      'courses/js/exams/mid/result/scoring-workspace'
    );
    expect(POSIX(path.relative(repoRoot, result))).toBe(
      'courses/js/exams/mid/result/scoring-workspace'
    );
  });

  it('rejects a path that escapes the repo root', () => {
    expect(() =>
      validateWorkspaceDirWithinRepo(repoRoot, '../outside/result/scoring-workspace')
    ).toThrow();
  });

  it('rejects an absolute path outside the repo root', () => {
    const outside = path.resolve(os.tmpdir(), 'elsewhere', 'result', 'scoring-workspace');
    expect(() => validateWorkspaceDirWithinRepo(repoRoot, outside)).toThrow();
  });

  it('rejects paths that do not match courses/**/exams/**/result/scoring-workspace', () => {
    expect(() =>
      validateWorkspaceDirWithinRepo(repoRoot, 'courses/js/exams/mid/result/temp/scoring-workspace')
    ).toThrow();
    expect(() =>
      validateWorkspaceDirWithinRepo(repoRoot, 'data/workspaces/exam_aaaa')
    ).toThrow();
    expect(() =>
      validateWorkspaceDirWithinRepo(repoRoot, 'courses/js/exams/mid/result/scoring-workspaces/x')
    ).toThrow();
  });
});
