import { test, expect } from '@playwright/test';
import { cleanupTrackedWorkspaces, withWorkspace } from './utils/workspace';

test.afterEach(async ({ page }) => {
  await cleanupTrackedWorkspaces(page.request);
});

const FORBIDDEN_PATTERNS = [
  'Encountered a script tag while rendering React component',
  "Hydration failed because the server rendered text didn't match the client",
];

test('workspace reload does not emit script or hydration console errors', async ({ page }) => {
  const errors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });

  page.on('pageerror', (error) => {
    errors.push(error.message);
  });

  await withWorkspace(page, 'E2E Hydration Console', async (workspaceId) => {
    await page.goto(`/workspace/${workspaceId}`);
    await expect(page.getByText('QTI 3.0 採点システム')).toBeVisible();

    await page.reload();
    await expect(page.getByText('QTI 3.0 採点システム')).toBeVisible();

    const joined = errors.join('\n');
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(joined, `unexpected console error matching: ${pattern}`).not.toContain(
        pattern
      );
    }
  });
});
