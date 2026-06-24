import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { resolveApplyToQtiResultsCliPath } from './qtiTools';

describe('resolveApplyToQtiResultsCliPath', () => {
  it('resolves apply-to-qti-results CLI from the workspace node_modules bin metadata', () => {
    const cliPath = resolveApplyToQtiResultsCliPath(process.cwd());
    expect(cliPath).toContain(path.join('node_modules', 'apply-to-qti-results'));
    expect(fs.existsSync(cliPath)).toBe(true);
  });

  it('uses package bin metadata instead of assuming source files are installed', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qti-tools-'));
    const toolsRoot = path.join(tempRoot, 'node_modules', 'apply-to-qti-results');
    try {
      fs.mkdirSync(path.join(toolsRoot, 'dist'), { recursive: true });
      const pkgPath = path.join(toolsRoot, 'package.json');
      fs.writeFileSync(
        pkgPath,
        JSON.stringify({ bin: { 'apply-to-qti-results': 'dist/cli.js' } }),
        'utf-8'
      );
      fs.writeFileSync(path.join(toolsRoot, 'dist', 'cli.js'), '', 'utf-8');

      const cliPath = resolveApplyToQtiResultsCliPath(tempRoot);
      expect(cliPath).toBe(path.join(toolsRoot, 'dist', 'cli.js'));
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('walks up parent directories when startDir is below the package root', () => {
    // The package layout is `<tempRoot>/node_modules/apply-to-qti-results/...`.
    // The caller passes a `startDir` that lives BELOW `<tempRoot>` and has NO
    // `<startDir>/node_modules/apply-to-qti-results` of its own, so the
    // function's fast path (`path.join(startDir, 'node_modules', PACKAGE_NAME)`)
    // fails to find a `package.json` there and it falls back to walking
    // parent directories until it locates the package root.
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qti-tools-'));
    const nestedStart = path.join(tempRoot, 'nested', 'deeper');
    const toolsRoot = path.join(tempRoot, 'node_modules', 'apply-to-qti-results');
    try {
      fs.mkdirSync(path.join(toolsRoot, 'dist'), { recursive: true });
      fs.mkdirSync(nestedStart, { recursive: true });

      fs.writeFileSync(
        path.join(toolsRoot, 'package.json'),
        JSON.stringify({ bin: { 'apply-to-qti-results': 'dist/cli.js' } }),
        'utf-8'
      );
      fs.writeFileSync(path.join(toolsRoot, 'dist', 'cli.js'), '', 'utf-8');

      const cliPath = resolveApplyToQtiResultsCliPath(nestedStart);
      expect(cliPath).toBe(path.join(toolsRoot, 'dist', 'cli.js'));
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
