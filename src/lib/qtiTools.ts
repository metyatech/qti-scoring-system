import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createRequire } from 'module';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

const resolveToolsRoot = () => path.dirname(require.resolve('apply-to-qti-results/package.json'));

const resolveTsxCli = () => require.resolve('tsx/dist/cli.mjs');

export const applyQtiResultsUpdate = async (params: {
  resultsPath: string;
  assessmentTestPath: string;
  scoringPath: string;
  preserveMet?: boolean;
}) => {
  const toolsRoot = resolveToolsRoot();
  const tsxCli = resolveTsxCli();
  const applyCli = path.join(toolsRoot, 'src', 'cli.ts');

  if (!fs.existsSync(toolsRoot)) {
    throw new Error(`apply-to-qti-results が見つかりません: ${toolsRoot}`);
  }
  if (!fs.existsSync(tsxCli)) {
    throw new Error(`tsx CLI が見つかりません: ${tsxCli}`);
  }
  if (!fs.existsSync(applyCli)) {
    throw new Error(`apply-to-qti-results CLI が見つかりません: ${applyCli}`);
  }

  const args: string[] = [
    tsxCli,
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
      cwd: toolsRoot,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (execResult.stderr) {
      console.warn('apply-to-qti-results stderr:', execResult.stderr);
    }
    return await fs.promises.readFile(params.resultsPath, 'utf-8');
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const raw = err.stdout || '';
    try {
      const payload = JSON.parse(raw) as { reason?: string; path?: string; identifier?: string };
      const detail = payload.identifier ? `${payload.identifier}: ${payload.reason}` : payload.reason;
      throw new Error(detail || 'QTI 結果の更新に失敗しました');
    } catch {
      throw new Error(err.message || 'QTI 結果の更新に失敗しました');
    }
  }
};
