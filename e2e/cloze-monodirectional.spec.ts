import { expect, test } from '@playwright/test';
import { withWorkspace, waitForResultsUpdate } from './utils/workspace';

test('cloze rubric upgrade reconciles with the server-confirmed value', async ({ page }) => {
  await withWorkspace(
    page,
    'E2E Cloze Monodirectional',
    async (workspaceId) => {
      await page.goto(`/workspace/${workspaceId}`);
      await expect(page.getByRole('heading', { name: 'E2E Cloze Item' })).toBeVisible();

      // No 〇 / × button is rendered for cloze items that are still ungraded.
      await expect(page.getByRole('button', { name: '〇' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '×' })).toHaveCount(0);

      const upgradeResponse = waitForResultsUpdate(page, {
        workspaceId,
        resultFile: 'assessmentResult-cloze-1.xml',
        itemIdentifier: 'item-1',
      });
      await page.getByRole('button', { name: '正答に変更' }).first().click();
      const response = await upgradeResponse;
      expect(response.status()).toBe(200);

      const body = (await response.json()) as {
        items?: Array<{
          identifier: string;
          rubricOutcomes: Record<number, boolean>;
        }>;
        testScore?: number | null;
      };
      expect(body.items?.[0]?.identifier).toBe('item-1');
      expect(body.items?.[0]?.rubricOutcomes[1]).toBe(true);

      // After reconciliation, the first criterion (the one we just upgraded)
      // should now render the locked message instead of the upgrade button.
      const firstCriterion = page.getByText('[1] Capital is correct').locator('..');
      await expect(firstCriterion.getByText('正答から誤答には変更できません')).toBeVisible();
      await expect(firstCriterion.getByRole('button', { name: '正答に変更' })).toHaveCount(0);

      // Reload and confirm the value is still true (i.e. the server side
      // round-trips the change and the page reads it back on init).
      await page.reload();
      await expect(page.getByRole('heading', { name: 'E2E Cloze Item' })).toBeVisible();
      await expect(page.getByText('正答から誤答には変更できません')).toBeVisible();
    },
    'assessmentResult-cloze-1.xml',
    'assessment-cloze'
  );
});
