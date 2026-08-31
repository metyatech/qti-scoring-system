import { defineConfig } from '@playwright/test';

const webServerEnv: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string'
  )
);

webServerEnv.QTI_SCORING_SYSTEM_REPO_ROOT = '';
webServerEnv.QTI_SCORING_SYSTEM_WORKSPACE_INDEX = '';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  // Local Windows runners can saturate the Next.js dev server and
  // cause timeout-based flakes when too many workers run in parallel.
  // CI environments pin their own worker count via Playwright's defaults
  // (and can still override with --workers if needed).
  workers: process.env.CI ? undefined : 2,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100',
    env: webServerEnv,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
