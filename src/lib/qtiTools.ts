import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

type PackageJson = {
  bin?: string | Record<string, string>;
};

const findPackageRoot = (packageName: string, startDir: string) => {
  let current = startDir;
  while (true) {
    const candidate = path.join(current, 'node_modules', packageName);
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  throw new Error('package が見つかりません: ' + packageName + ' (start: ' + startDir + ')');
};

const resolvePackageBinPath = (packageName: string, binName: string, startDir: string) => {
  const packageRoot = findPackageRoot(packageName, startDir);
  const pkgPath = path.join(packageRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as PackageJson;
  const bin =
    typeof pkg.bin === 'string' ? pkg.bin : pkg.bin && binName in pkg.bin ? pkg.bin[binName] : undefined;
  if (!bin) {
    throw new Error(`${packageName} の bin 設定が見つかりません: ${binName}`);
  }
  return path.resolve(packageRoot, bin);
};

export const resolveApplyToQtiResultsCliPath = (startDir: string = process.cwd()) =>
  resolvePackageBinPath('apply-to-qti-results', 'apply-to-qti-results', startDir);

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
