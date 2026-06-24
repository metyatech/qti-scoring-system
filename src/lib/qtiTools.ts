import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

type PackageJson = {
  bin?: string | Record<string, string>;
};

const PACKAGE_NAME = 'apply-to-qti-results';
const BIN_NAME = 'apply-to-qti-results';

/**
 * Resolve the absolute path of the `apply-to-qti-results` CLI entry script.
 *
 * The walk-then-read pattern (find any `node_modules/<pkg>/package.json` up
 * the tree, parse its `bin` field) is the most general way to honour the
 * workspace dependency's `bin` metadata, but it requires unbounded
 * filesystem traversal at runtime, which Turbopack's static NFT analysis
 * cannot follow and which it reports as an "unexpected file in NFT list"
 * warning. To keep the bundler happy without giving up the bin-metadata
 * source of truth, the fast path is anchored to `process.cwd()` (a literal
 * the bundler can see) plus a `node_modules` segment — a fixed prefix that
 * scopes every call to a known subfolder. The walk is preserved as a
 * fallback so a non-default install layout still resolves, but every join
 * inside it is guarded by a `turbopackIgnore` comment that the bundler
 * recognises.
 */
export const resolveApplyToQtiResultsCliPath = (startDir: string = process.cwd()) => {
  // Direct path under `<startDir>/node_modules/<pkg>` — the common case
  // for the workspace install and for tests that point the resolver at a
  // scratch directory.
  const directRoot = path.join(startDir, 'node_modules', PACKAGE_NAME);
  const directPkg = path.join(directRoot, 'package.json');
  if (fs.existsSync(directPkg)) {
    const pkg = JSON.parse(fs.readFileSync(directPkg, 'utf-8')) as PackageJson;
    const bin =
      typeof pkg.bin === 'string'
        ? pkg.bin
        : pkg.bin && BIN_NAME in pkg.bin
          ? pkg.bin[BIN_NAME]
          : undefined;
    if (!bin) {
      throw new Error(`${PACKAGE_NAME} の bin 設定が見つかりません: ${BIN_NAME}`);
    }
    return path.resolve(directRoot, bin);
  }

  // Fallback: walk up from `startDir` for unusual install layouts.
  let current: string = startDir;
  while (true) {
    const candidate = path.join(
      /*turbopackIgnore: true*/ current,
      'node_modules',
      PACKAGE_NAME,
    );
    if (
      fs.existsSync(
        path.join(/*turbopackIgnore: true*/ candidate, 'package.json'),
      )
    ) {
      const pkg = JSON.parse(
        fs.readFileSync(
          path.join(/*turbopackIgnore: true*/ candidate, 'package.json'),
          'utf-8',
        ),
      ) as PackageJson;
      const bin =
        typeof pkg.bin === 'string'
          ? pkg.bin
          : pkg.bin && BIN_NAME in pkg.bin
            ? pkg.bin[BIN_NAME]
            : undefined;
      if (!bin) {
        throw new Error(`${PACKAGE_NAME} の bin 設定が見つかりません: ${BIN_NAME}`);
      }
      return path.resolve(/*turbopackIgnore: true*/ candidate, bin);
    }
    const parent = path.dirname(/*turbopackIgnore: true*/ current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  throw new Error('package が見つかりません: ' + PACKAGE_NAME + ' (start: ' + startDir + ')');
};

export const applyQtiResultsUpdate = async (params: {
  resultsPath: string;
  assessmentTestPath: string;
  scoringPath: string;
  preserveMet?: boolean;
}) => {
  const applyCli = resolveApplyToQtiResultsCliPath();

  if (!fs.existsSync(applyCli)) {
    throw new Error('apply-to-qti-results CLI が見つかりません: ' + applyCli);
  }

  const args: string[] = [
    applyCli,
    '--results',
    params.resultsPath,
    '--assessment-test',
    params.assessmentTestPath,
    '--scoring',
    params.scoringPath,
  ];
  if (params.preserveMet) {
    args.push('--preserve-met');
  }

  try {
    const execResult = await execFileAsync('node', args, {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
    });
    if (execResult.stderr) {
      console.warn('apply-to-qti-results stderr:', execResult.stderr);
    }
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const raw = err.stdout || '';
    try {
      const payload = JSON.parse(raw) as { reason?: string; path?: string; identifier?: string };
      const detail = payload.identifier ? payload.identifier + ': ' + payload.reason : payload.reason;
      throw new Error(detail || 'QTI 結果の更新に失敗しました');
    } catch {
      throw new Error(err.message || 'QTI 結果の更新に失敗しました');
    }
  }

  return await fs.promises.readFile(params.resultsPath, 'utf-8');
};
