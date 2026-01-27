import { test, expect } from '@playwright/test';
import path from 'path';

test('comment textarea auto-resizes with content', async ({ page }) => {
  await page.goto('/workspace/new');

  await page.getByLabel('ワークスペース名 *').fill('E2E Auto Resize');

  const assessmentInput = page.locator('input[type="file"]').nth(0);
  await assessmentInput.setInputFiles(path.join(process.cwd(), 'e2e', 'fixtures', 'assessment'));

  const resultsInput = page.locator('input[type="file"]').nth(1);
  await resultsInput.setInputFiles(
    path.join(process.cwd(), 'e2e', 'fixtures', 'results', 'assessmentResult-1.xml')
  );

  await page.getByRole('button', { name: 'ワークスペースを作成' }).click();
  await page.waitForURL(/\/workspace\//);
  await page.getByText('設問ごと').waitFor();

  const textarea = page.locator('textarea').first();
  await expect(textarea).toBeVisible();

  const initialHeight = await textarea.evaluate((el) => el.clientHeight);
  await textarea.fill('Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6');

  await expect.poll(async () => textarea.evaluate((el) => el.clientHeight)).toBeGreaterThan(initialHeight);
});

test('item quick preview opens in item view', async ({ page }) => {
  await page.goto('/workspace/new');

  await page.getByLabel('ワークスペース名 *').fill('E2E Item Preview');

  const assessmentInput = page.locator('input[type="file"]').nth(0);
  await assessmentInput.setInputFiles(path.join(process.cwd(), 'e2e', 'fixtures', 'assessment'));

  const resultsInput = page.locator('input[type="file"]').nth(1);
  await resultsInput.setInputFiles(
    path.join(process.cwd(), 'e2e', 'fixtures', 'results', 'assessmentResult-1.xml')
  );

  await page.getByRole('button', { name: 'ワークスペースを作成' }).click();
  await page.waitForURL(/\/workspace\//);

  await page.getByRole('button', { name: '設問を開く' }).click();
  await expect(page.getByRole('heading', { name: '設問プレビュー' })).toBeVisible();
  await expect(page.getByTestId('item-preview-body').getByText('Explain your answer.')).toBeVisible();
  await page.getByTestId('item-preview-overlay').click({ position: { x: 10, y: 10 } });
  await expect(page.getByRole('heading', { name: '設問プレビュー' })).toBeHidden();
});
