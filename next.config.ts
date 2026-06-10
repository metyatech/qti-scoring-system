import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

type TSConfigCompilerOptions = {
  paths?: Record<string, readonly string[]>;
  baseUrl?: string;
};

const tsconfig = JSON.parse(readFileSync(resolve(projectRoot, "tsconfig.json"), "utf8")) as {
  compilerOptions?: TSConfigCompilerOptions;
};

const tsPaths: Record<string, readonly string[]> = tsconfig.compilerOptions?.paths ?? {};
const tsBaseUrl: string = tsconfig.compilerOptions?.baseUrl ?? "./";

const nextConfig: NextConfig = {
  // Next.js 16 enables Turbopack by default. An empty `turbopack` config
  // suppresses the "this build is using Turbopack with a webpack config"
  // error and lets the explicit `webpack` config below take over when the
  // dev server is started with `--webpack`.
  turbopack: {},
  // The repo's TypeScript source uses path aliases such as `@/lib/...`. Next
  // 16's automatic alias resolution works for the SWC pipeline used by the
  // App Router runtime, but the underlying webpack bundler still needs an
  // explicit `resolve.alias` map when the alias is consumed by code paths
  // (such as server components) that fall through to a raw bundler
  // resolution step. Derive the alias map from tsconfig.json so the two
  // configurations stay in sync.
  webpack: (config) => {
    const alias: Record<string, string> = {};
    const baseDir = resolve(projectRoot, tsBaseUrl);
    for (const [aliasKey, aliasValues] of Object.entries(tsPaths)) {
      const trimmed = aliasKey.endsWith("/*") ? aliasKey.slice(0, -2) : aliasKey;
      const target = aliasValues[0] ?? "";
      const targetPath = target.endsWith("/*")
        ? resolve(baseDir, target.slice(0, -2))
        : resolve(baseDir, target);
      alias[trimmed] = targetPath;
    }
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias as Record<string, string> | undefined),
      ...alias
    };
    return config;
  }
};

export default nextConfig;
