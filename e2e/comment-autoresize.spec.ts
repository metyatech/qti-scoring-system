import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { cleanupTrackedWorkspaces, withWorkspace, waitForResultsUpdate } from './utils/workspace';
import { getTextareaMetrics, waitForTextareaToFitContent } from './utils/textarea';

test.afterEach(async ({ page }) => {
  await cleanupTrackedWorkspaces(page.request);
});


test('comment textarea auto-resizes with content', async ({ page }) => {
  await withWorkspace(page, 'E2E Auto Resize', async () => {
    await page.getByText('設問ごと').waitFor();

    // getByLabel('コメント') targets the candidate comment textarea via its
    // <label htmlFor> wiring (see ItemCandidateCard.tsx). If multiple cards
    // ever surface the label at once, fall back to the first one.
    const commentLabel = page.getByLabel('コメント');
    const textarea = (await commentLabel.count()) > 1 ? commentLabel.first() : commentLabel;
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveValue('Initial comment');

    // Sanity-check that the seeded value already fits inside the rendered box
    // before we ask the textarea to grow.
    await waitForTextareaToFitContent(textarea);
    const initialMetrics = await getTextareaMetrics(textarea);

    // A long, multi-line comment is needed because a short fill can land
    // inside the existing row band and produce zero scrollHeight delta.
    const longComment = Array.from(
      { length: 12 },
      (_, index) => `Line ${index + 1}: auto resize stability check`,
    ).join('\n');

    await textarea.fill(longComment);
    await expect(textarea).toHaveValue(longComment);
    await waitForTextareaToFitContent(textarea);

    const grownMetrics = await getTextareaMetrics(textarea);
    expect(grownMetrics.styleHeightPx).toBeGreaterThan(initialMetrics.styleHeightPx);
    expect(grownMetrics.scrollHeight).toBeGreaterThan(initialMetrics.scrollHeight);
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
  await withWorkspace(page, 'E2E Save Feedback', async (workspaceId) => {
    const saveResponse = waitForResultsUpdate(page, {
      workspaceId,
      resultFile: 'assessmentResult-1.xml',
      itemIdentifier: 'item-1',
    });
    await page.getByRole('button', { name: '〇' }).first().click();
    const response = await saveResponse;
    expect(response.status()).toBe(200);

    await expect(page.getByTestId('save-status-assessmentResult-1.xml-item-1-criterion-1')).toContainText(
      '保存しました'
    );
  });
});

test('clearing a comment removes it without errors', async ({ page }) => {
  await withWorkspace(page, 'E2E Comment Clear', async (workspaceId) => {
    // Target the candidate comment textarea via its <label htmlFor> wiring
    // (see ItemCandidateCard.tsx). Only one comment textarea is mounted in
    // the candidate view, so a plain getByLabel is unambiguous.
    const textarea = page.getByLabel('コメント');
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveValue('Initial comment');

    // Subscribe to the exact PUT before we trigger blur. The previous version
    // matched only the loose `/api/workspaces/.../results` URL, so a future
    // same-page save request could accidentally satisfy the wait before the
    // comment-clear request we intended to assert. Pinning workspaceId +
    // resultFile + itemIdentifier + the empty comment value makes the test
    // wait for the specific save caused by this blur.
    await textarea.fill('');
    await expect(textarea).toHaveValue('');

    const saveResponse = waitForResultsUpdate(page, {
      workspaceId,
      resultFile: 'assessmentResult-1.xml',
      itemIdentifier: 'item-1',
      comment: '',
    });

    // Drive the save through the real onBlur handler instead of clicking a
    // sibling heading. This removes dependence on layout/focus side effects and
    // makes the save trigger explicit.
    await textarea.blur();

    const response = await saveResponse;
    expect(response.status()).toBe(200);
    await expect(
      page.getByTestId('save-status-assessmentResult-1.xml-item-1-comment'),
    ).toContainText('保存しました');

    // After reload the seed value should be gone, and the transient save
    // status indicator should be absent (the page re-renders without it
    // until the next save).
    await page.reload();
    const reloadedTextarea = page.getByLabel('コメント');
    await expect(reloadedTextarea).toHaveValue('');
    await expect(
      page.getByTestId('save-status-assessmentResult-1.xml-item-1-comment'),
    ).toHaveCount(0);
  });
});

test('rubric changes persist after reload', async ({ page }) => {
  await withWorkspace(page, 'E2E Rubric Persistence', async (workspaceId) => {
    const criterionOne = page.getByText('[1] Provides any answer').locator('..');
    const criterionTwo = page.getByText('[2] Explains reasoning').locator('..');

    const saveOne = waitForResultsUpdate(page, {
      workspaceId,
      resultFile: 'assessmentResult-1.xml',
      itemIdentifier: 'item-1',
    });
    await criterionOne.getByRole('button', { name: '〇' }).click();
    expect((await saveOne).status()).toBe(200);

    const saveTwo = waitForResultsUpdate(page, {
      workspaceId,
      resultFile: 'assessmentResult-1.xml',
      itemIdentifier: 'item-1',
    });
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
    const saveRubricOne = waitForResultsUpdate(page, {
      workspaceId,
      resultFile: 'assessmentResult-1.xml',
      itemIdentifier: 'item-1',
    });
    await criterionOne.getByRole('button', { name: '〇' }).click();
    expect((await saveRubricOne).status()).toBe(200);

    const saveRubricTwo = waitForResultsUpdate(page, {
      workspaceId,
      resultFile: 'assessmentResult-1.xml',
      itemIdentifier: 'item-1',
    });
    await criterionTwo.getByRole('button', { name: '×' }).click();
    expect((await saveRubricTwo).status()).toBe(200);

    const textarea = page.getByLabel('コメント');
    await textarea.fill('Exported comment');
    await expect(textarea).toHaveValue('Exported comment');
    const saveComment = waitForResultsUpdate(page, {
      workspaceId,
      resultFile: 'assessmentResult-1.xml',
      itemIdentifier: 'item-1',
      comment: 'Exported comment',
    });
    await textarea.blur();
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

test('total score reflects rubric outcomes even when item score is stale', async ({ page }) => {
  await withWorkspace(page, 'E2E Total Score', async () => {
    await page.getByRole('button', { name: '受講者ごと' }).click();
    await expect(page.getByText(/合計:\s*3\s*\/\s*3/)).toBeVisible();
  }, 'assessmentResult-score-stale.xml');
});
