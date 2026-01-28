import { test, expect } from '@playwright/test';
import { withWorkspace } from './utils/workspace';

test('item view renders results incrementally', async ({ page }) => {
  const resultsFiles = Array.from({ length: 12 }, (_, index) => {
    const num = String(index + 1).padStart(2, '0');
    return `assessmentResult-batch-${num}.xml`;
  });

  await withWorkspace(
    page,
    'E2E Incremental',
    async (workspaceId) => {
      await page.goto(`/workspace/${workspaceId}`);
      await expect(page.getByText('問1:')).toBeVisible();

      const progress = page.getByTestId('item-result-progress');
      await expect(progress).toContainText('受講者:');
      await expect(progress).toContainText('/ 12');
      await expect(progress).toHaveText('受講者: 12 / 12', { timeout: 10000 });
    },
    resultsFiles,
    'assessment-multi'
  );
});
