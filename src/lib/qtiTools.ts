import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const resolveToolsRoot = () =>
  process.env.APPLY_TO_QTI_RESULTS_DIR || path.resolve(process.cwd(), '..', 'apply-to-qti-results');

const resolveTsxCli = (toolsRoot: string) =>
  process.env.TSX_CLI_PATH || path.join(toolsRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

export const applyQtiResultsUpdate = async (params: {
  resultsPath: string;
  itemPaths: string[];
  scoringPath: string;
  mappingPath?: string;
  preserveMet?: boolean;
}) => {
  const toolsRoot = resolveToolsRoot();
  const tsxCli = resolveTsxCli(toolsRoot);
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

  const args: string[] = [tsxCli, applyCli, '--results', params.resultsPath, '--scoring', params.scoringPath];
  if (params.mappingPath) {
    args.push('--mapping', params.mappingPath);
  }
  for (const itemPath of params.itemPaths) {
    args.push('--item', itemPath);
  }
  if (params.preserveMet) {
    args.push('--preserve-met');
  }

  try {
    const { stdout, stderr } = await execFileAsync('node', args, {
      cwd: toolsRoot,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (stderr) {
      console.warn('apply-to-qti-results stderr:', stderr);
    }
    return stdout;
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
