import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const findPackageRoot = (packageName: string, startDir: string) => {
  let current = startDir;
  while (true) {
    const candidate = path.join(current, 'node_modules', packageName, 'package.json');
    if (fs.existsSync(candidate)) {
      return path.dirname(candidate);
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  throw new Error(`package が見つかりません: ${packageName} (start: ${startDir})`);
};

const resolveReporterCliPath = () => {
  const packageRoot = findPackageRoot('qti-reporter', process.cwd());
  const cliPath = path.join(packageRoot, 'dist', 'cli.js');
  if (!fs.existsSync(cliPath)) {
    throw new Error(`qti-reporter の CLI が見つかりません: ${cliPath}`);
  }
  return cliPath;
};

export const generateCsvReport = async (params: {
  assessmentTestPath: string;
  assessmentResultPaths: string[];
}) => {
  const { assessmentTestPath, assessmentResultPaths } = params;
  if (assessmentResultPaths.length === 0) {
    throw new Error('assessmentResult が指定されていません');
  }

  const cliPath = resolveReporterCliPath();
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qti-report-'));
  try {
    const sortedResults = [...assessmentResultPaths].sort();
    const args = [
      cliPath,
      '--assessment-test',
      assessmentTestPath,
      ...sortedResults.flatMap((resultPath) => ['--assessment-result', resultPath]),
      '--out-dir',
      tempRoot,
    ];
    await execFileAsync(process.execPath, args, {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
    });

    const csvPath = path.join(tempRoot, 'report.csv');
    if (!fs.existsSync(csvPath)) {
      throw new Error('CSV の生成に失敗しました');
    }
    return await fs.promises.readFile(csvPath, 'utf-8');
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
};

export const generateReportOutput = async (params: {
  assessmentTestPath: string;
  assessmentResultPaths: string[];
}) => {
  const { assessmentTestPath, assessmentResultPaths } = params;
  if (assessmentResultPaths.length === 0) {
    throw new Error('assessmentResult が指定されていません');
  }

  const cliPath = resolveReporterCliPath();
  const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qti-report-'));
  const sortedResults = [...assessmentResultPaths].sort();

  const args = [
    cliPath,
    '--assessment-test',
    assessmentTestPath,
    ...sortedResults.flatMap((resultPath) => ['--assessment-result', resultPath]),
    '--out-dir',
    outputDir,
  ];
  await execFileAsync(process.execPath, args, {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
  });

  return {
    outputDir,
    cleanup: async () => {
      await fs.promises.rm(outputDir, { recursive: true, force: true });
    },
  };
};
