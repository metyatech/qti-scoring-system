import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import JSZip from 'jszip';

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

const deleteWorkspace = async (page: Page, workspaceId: string) => {
  await page.request.delete(`/api/workspaces/${workspaceId}`);
};

const withWorkspace = async (
  page: Page,
  name: string,
  run: (workspaceId: string) => Promise<void>
) => {
  const workspaceId = await createWorkspace(page, name);
  try {
    await run(workspaceId);
  } finally {
    await deleteWorkspace(page, workspaceId);
  }
};

const waitForResultsUpdate = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().includes('/api/workspaces/') &&
      response.url().includes('/results')
  );


test('comment textarea auto-resizes with content', async ({ page }) => {
  await withWorkspace(page, 'E2E Auto Resize', async () => {
    await page.getByText('設問ごと').waitFor();

    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible();

    const initialHeight = await textarea.evaluate((el) => el.clientHeight);
    await textarea.fill('Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6');

    await expect.poll(async () => textarea.evaluate((el) => el.clientHeight)).toBeGreaterThan(initialHeight);
  });
});

test('item quick preview opens in item view', async ({ page }) => {
  await withWorkspace(page, 'E2E Item Preview', async () => {
    await page.getByRole('button', { name: '設問を開く' }).click();
    await expect(page.getByRole('heading', { name: '設問プレビュー' })).toBeVisible();
    await expect(page.getByTestId('item-preview-body').getByText('Explain your answer.')).toBeVisible();
    await page.getByTestId('item-preview-overlay').click({ position: { x: 10, y: 10 } });
    await expect(page.getByRole('heading', { name: '設問プレビュー' })).toBeHidden();
  });
});

test('save feedback appears after scoring update', async ({ page }) => {
  await withWorkspace(page, 'E2E Save Feedback', async () => {
    const saveResponse = waitForResultsUpdate(page);
    await page.getByRole('button', { name: '〇' }).first().click();
    const response = await saveResponse;
    expect(response.status()).toBe(200);

    await expect(page.getByTestId('save-status-assessmentResult-1.xml-item-1-criterion-1')).toContainText(
      '保存しました'
    );
  });
});

test('clearing a comment removes it without errors', async ({ page }) => {
  await withWorkspace(page, 'E2E Comment Clear', async () => {
    const textarea = page.locator('textarea').first();
    await expect(textarea).toHaveValue('Initial comment');

    const saveResponse = waitForResultsUpdate(page);
    await textarea.fill('');
    await page.getByRole('heading', { name: 'QTI 3.0 採点システム' }).click();
    const response = await saveResponse;
    expect(response.status()).toBe(200);

    await page.reload();
    await expect(page.locator('textarea').first()).toHaveValue('');
    await expect(page.getByTestId('save-status-assessmentResult-1.xml-item-1-comment')).toHaveCount(0);
  });
});

test('rubric changes persist after reload', async ({ page }) => {
  await withWorkspace(page, 'E2E Rubric Persistence', async () => {
    const criterionOne = page.getByText('[1] Provides any answer').locator('..');
    const criterionTwo = page.getByText('[2] Explains reasoning').locator('..');

    const saveOne = waitForResultsUpdate(page);
    await criterionOne.getByRole('button', { name: '〇' }).click();
    expect((await saveOne).status()).toBe(200);

    const saveTwo = waitForResultsUpdate(page);
    await criterionTwo.getByRole('button', { name: '×' }).click();
    expect((await saveTwo).status()).toBe(200);

    await page.reload();

    const reloadedCriterionOne = page.getByText('[1] Provides any answer').locator('..');
    const reloadedCriterionTwo = page.getByText('[2] Explains reasoning').locator('..');
    await expect(reloadedCriterionOne.getByRole('button', { name: '〇' })).toHaveClass(/bg-green-600/);
    await expect(reloadedCriterionTwo.getByRole('button', { name: '×' })).toHaveClass(/bg-red-600/);
  });
});

test('export includes updated rubric and comment', async ({ page }) => {
  await withWorkspace(page, 'E2E Export', async (workspaceId) => {
    const criterionOne = page.getByText('[1] Provides any answer').locator('..');
    const criterionTwo = page.getByText('[2] Explains reasoning').locator('..');
    const saveRubricOne = waitForResultsUpdate(page);
    await criterionOne.getByRole('button', { name: '〇' }).click();
    expect((await saveRubricOne).status()).toBe(200);

    const saveRubricTwo = waitForResultsUpdate(page);
    await criterionTwo.getByRole('button', { name: '×' }).click();
    expect((await saveRubricTwo).status()).toBe(200);

    const textarea = page.locator('textarea').first();
    await textarea.fill('Exported comment');
    const saveComment = waitForResultsUpdate(page);
    await page.getByRole('heading', { name: 'QTI 3.0 採点システム' }).click();
    expect((await saveComment).status()).toBe(200);

    const exportResponse = await page.request.get(`/api/workspaces/${workspaceId}/report/zip`);
    expect(exportResponse.status()).toBe(200);
    const zipBuffer = await exportResponse.body();
    const zip = await JSZip.loadAsync(zipBuffer);
    const resultEntry = zip.file('results/assessmentResult-1.xml');
    if (!resultEntry) {
      throw new Error('results/assessmentResult-1.xml not found in zip');
    }
    const xml = await resultEntry.async('string');
    expect(xml).toMatch(/<outcomeVariable identifier="RUBRIC_1_MET"[\s\S]*?<value>true<\/value>/);
    expect(xml).toMatch(/<outcomeVariable identifier="COMMENT"[\s\S]*?<value>Exported comment<\/value>/);
  });
});
