import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resolveResultPath,
  sanitizeResultFileName,
  updateResultXml,
} from '@/lib/workspace';

describe('sanitizeResultFileName', () => {
  it('accepts a flat basename that already exists under results', () => {
    expect(sanitizeResultFileName('assessmentResult-1.xml')).toBe('assessmentResult-1.xml');
  });

  it('rejects names with path separators', () => {
    expect(() => sanitizeResultFileName('../workspace.json')).toThrow();
    expect(() => sanitizeResultFileName('subdir/foo.xml')).toThrow();
    expect(() => sanitizeResultFileName('C:\\evil\\file.xml')).toThrow();
  });

  it('rejects empty or dot-only names', () => {
    expect(() => sanitizeResultFileName('')).toThrow();
    expect(() => sanitizeResultFileName('.')).toThrow();
    expect(() => sanitizeResultFileName('..')).toThrow();
  });
});

describe('resolveResultPath', () => {
  let workspaceDir: string;
  let resultsDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qti-resolve-result-'));
    resultsDir = path.join(workspaceDir, 'results');
    await fs.promises.mkdir(resultsDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(resultsDir, 'assessmentResult-1.xml'),
      '<results/>',
      'utf-8'
    );
  });

  afterEach(async () => {
    await fs.promises.rm(workspaceDir, { recursive: true, force: true });
  });

  it('returns the absolute path for a valid result file name', () => {
    const resolved = resolveResultPath(workspaceDir, 'assessmentResult-1.xml');
    expect(resolved).toBe(path.join(resultsDir, 'assessmentResult-1.xml'));
  });

  it('rejects traversal attempts that resolve outside the results directory', () => {
    expect(() => resolveResultPath(workspaceDir, '../workspace.json')).toThrow();
  });

  it('rejects traversal even when the file exists outside results', async () => {
    await fs.promises.writeFile(
      path.join(workspaceDir, 'workspace.json'),
      '{}',
      'utf-8'
    );
    expect(() => resolveResultPath(workspaceDir, '../workspace.json')).toThrow();
  });
});

describe('updateResultXml realpath containment', () => {
  let workspaceDir: string;
  let resultsDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qti-update-result-'));
    resultsDir = path.join(workspaceDir, 'results');
    await fs.promises.mkdir(resultsDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(resultsDir, 'assessmentResult-1.xml'),
      '<results/>',
      'utf-8'
    );
  });

  afterEach(async () => {
    await fs.promises.rm(workspaceDir, { recursive: true, force: true });
  });

  it('writes the updated XML to a file inside results/', async () => {
    await updateResultXml(workspaceDir, 'assessmentResult-1.xml', '<results>ok</results>');
    const updated = await fs.promises.readFile(
      path.join(resultsDir, 'assessmentResult-1.xml'),
      'utf-8'
    );
    expect(updated).toBe('<results>ok</results>');
  });

  it('refuses to write through a symlink that escapes results/', async () => {
    if (process.platform === 'win32') {
      // Symlink creation typically requires elevated privileges on Windows; skip.
      return;
    }
    const escapeTarget = path.join(os.tmpdir(), `escape-${Date.now()}.xml`);
    await fs.promises.writeFile(escapeTarget, '<original/>', 'utf-8');
    await fs.promises.symlink(escapeTarget, path.join(resultsDir, 'assessmentResult-2.xml'));
    try {
      await expect(
        updateResultXml(workspaceDir, 'assessmentResult-2.xml', '<tampered/>')
      ).rejects.toThrow();
      const after = await fs.promises.readFile(escapeTarget, 'utf-8');
      expect(after).toBe('<original/>');
    } finally {
      await fs.promises.rm(escapeTarget, { force: true });
    }
  });
});
