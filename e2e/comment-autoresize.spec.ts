import { test, expect, type Page } from '@playwright/test';
import path from 'path';

const createWorkspace = async (page: Page, name: string) => {
  await page.goto('/workspace/new');
  await page.getByLabel('ワークスペース名 *').fill(name);

  const assessmentInput = page.locator('input[type="file"]').nth(0);
  await assessmentInput.setInputFiles(path.join(process.cwd(), 'e2e', 'fixtures', 'assessment'));

  const resultsInput = page.locator('input[type="file"]').nth(1);
  await resultsInput.setInputFiles(
    path.join(process.cwd(), 'e2e', 'fixtures', 'results', 'assessmentResult-1.xml')
  );

  await page.getByRole('button', { name: 'ワークスペースを作成' }).click();
  await page.waitForURL(/\/workspace\/(?!new$).+/);

  const url = new URL(page.url());
  const parts = url.pathname.split('/').filter(Boolean);
  const workspaceId = parts[1];
  if (!workspaceId || workspaceId === 'new') {
    throw new Error(`workspaceId not found in url: ${url.toString()}`);
  }
  return workspaceId;
};


test('comment textarea auto-resizes with content', async ({ page }) => {
  await createWorkspace(page, 'E2E Auto Resize');
  await page.getByText('設問ごと').waitFor();

  const textarea = page.locator('textarea').first();
  await expect(textarea).toBeVisible();

  const initialHeight = await textarea.evaluate((el) => el.clientHeight);
  await textarea.fill('Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6');

  await expect.poll(async () => textarea.evaluate((el) => el.clientHeight)).toBeGreaterThan(initialHeight);
});

test('item quick preview opens in item view', async ({ page }) => {
  await createWorkspace(page, 'E2E Item Preview');

  await page.getByRole('button', { name: '設問を開く' }).click();
  await expect(page.getByRole('heading', { name: '設問プレビュー' })).toBeVisible();
  await expect(page.getByTestId('item-preview-body').getByText('Explain your answer.')).toBeVisible();
  await page.getByTestId('item-preview-overlay').click({ position: { x: 10, y: 10 } });
  await expect(page.getByRole('heading', { name: '設問プレビュー' })).toBeHidden();
});

test('save feedback appears after scoring update', async ({ page }) => {
  await createWorkspace(page, 'E2E Save Feedback');

  const saveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().includes('/api/workspaces/') &&
      response.url().includes('/results')
  );
  await page.getByRole('button', { name: '〇' }).first().click();
  const response = await saveResponse;
  expect(response.status()).toBe(200);

  await expect(page.getByTestId('save-status-assessmentResult-1.xml-item-1-criterion-1')).toContainText(
    '保存しました'
  );
});

test('clearing a comment removes it without errors', async ({ page }) => {
  await createWorkspace(page, 'E2E Comment Clear');

  const textarea = page.locator('textarea').first();
  await expect(textarea).toHaveValue('Initial comment');

  const saveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().includes('/api/workspaces/') &&
      response.url().includes('/results')
  );
  await textarea.fill('');
  await page.getByRole('heading', { name: 'QTI 3.0 採点システム' }).click();
  const response = await saveResponse;
  expect(response.status()).toBe(200);

  await page.reload();
  await expect(page.locator('textarea').first()).toHaveValue('');
  await expect(page.getByTestId('save-status-assessmentResult-1.xml-item-1-comment')).toHaveCount(0);
});
