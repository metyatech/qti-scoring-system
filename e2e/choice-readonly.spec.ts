import { expect, test } from '@playwright/test';
import { withWorkspace, waitForResultsUpdate } from './utils/workspace';

test('choice rubric is rendered read-only and comments still round-trip', async ({ page }) => {
  await withWorkspace(
    page,
    'E2E Choice Read-Only',
    async (workspaceId) => {
      await page.goto(`/workspace/${workspaceId}`);
      await expect(page.getByRole('heading', { name: 'E2E Choice Item' })).toBeVisible();

      // The rubric area for the choice item must not expose 〇 / × buttons.
      const rubricBlock = page.getByText('[1] Selected the correct answer').locator('..');
      await expect(rubricBlock.getByRole('button', { name: '〇' })).toHaveCount(0);
      await expect(rubricBlock.getByRole('button', { name: '×' })).toHaveCount(0);

      // The auto-score badge and the read-only hint are present.
      await expect(rubricBlock.getByTestId('rubric-choice-badge')).toBeVisible();
      await expect(rubricBlock.getByText('編集不可')).toBeVisible();

      // Comments remain editable. Type something and confirm it round-trips.
      const textarea = page.getByLabel('コメント');
      await expect(textarea).toBeVisible();
      await textarea.fill('Choice comment E2E');
      await expect(textarea).toHaveValue('Choice comment E2E');
      const saveComment = waitForResultsUpdate(page, {
        workspaceId,
        resultFile: 'assessmentResult-choice-1.xml',
        itemIdentifier: 'item-1',
        comment: 'Choice comment E2E',
      });
      await textarea.blur();
      const response = await saveComment;
      expect(response.status()).toBe(200);

      const body = (await response.json()) as {
        items?: Array<{ comment: string | null }>;
      };
      expect(body.items?.[0]?.comment).toBe('Choice comment E2E');

      await page.reload();
      await expect(page.getByRole('heading', { name: 'E2E Choice Item' })).toBeVisible();
      await expect(page.getByLabel('コメント')).toHaveValue('Choice comment E2E');
    },
    'assessmentResult-choice-1.xml',
    'assessment-choice'
  );
});
