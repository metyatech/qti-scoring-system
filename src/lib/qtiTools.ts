import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const findPackageRoot = (packageName: string, startDir: string) => {
  let current = startDir;
  while (true) {
    const candidate = path.join(current, "node_modules", packageName);
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  throw new Error(
    `package が見つかりません: ${packageName} (start: ${startDir})`
  );
};

const resolveToolsRoot = (startDir: string = process.cwd()) =>
  findPackageRoot("apply-to-qti-results", startDir);

export const resolveTsxCliPath = (startDir: string = process.cwd()) => {
  const tsxRoot = findPackageRoot("tsx", startDir);
  const pkgPath = path.join(tsxRoot, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
    bin?: string | Record<string, string>;
  };
  const bin =
    typeof pkg.bin === "string"
      ? pkg.bin
      : pkg.bin && "tsx" in pkg.bin
        ? pkg.bin.tsx
        : undefined;
  if (!bin) {
    throw new Error("tsx の bin 設定が見つかりません");
  }
  return path.resolve(tsxRoot, bin);
};

export const applyQtiResultsUpdate = async (params: {
  resultsPath: string;
  assessmentTestPath: string;
  scoringPath: string;
  preserveMet?: boolean;
}) => {
  const toolsRoot = resolveToolsRoot();
  const tsxCli = resolveTsxCliPath();
  const applyCli = path.join(toolsRoot, "src", "cli.ts");

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
    "--results",
    params.resultsPath,
    "--assessment-test",
    params.assessmentTestPath,
    "--scoring",
    params.scoringPath,
  ];
  if (params.preserveMet) {
    args.push("--preserve-met");
  }

  try {
    const execResult = await execFileAsync("node", args, {
      cwd: toolsRoot,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (execResult.stderr) {
      console.warn("apply-to-qti-results stderr:", execResult.stderr);
    }
    return await fs.promises.readFile(params.resultsPath, "utf-8");
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const raw = err.stdout || "";
    try {
      const payload = JSON.parse(raw) as {
        reason?: string;
        path?: string;
        identifier?: string;
      };
      const detail = payload.identifier
        ? `${payload.identifier}: ${payload.reason}`
        : payload.reason;
      throw new Error(detail || "QTI 結果の更新に失敗しました");
    } catch {
      throw new Error(err.message || "QTI 結果の更新に失敗しました");
    }
  }
};
