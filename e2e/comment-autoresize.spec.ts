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

    // Notion-style autosave: clearing the field saves automatically after the
    // debounce, without any blur. Pin workspaceId + resultFile + itemIdentifier
    // + the empty comment value + a 200 status so the wait matches the specific
    // save caused by this edit and not an unrelated request.
    const saveResponse = waitForResultsUpdate(page, {
      workspaceId,
      resultFile: 'assessmentResult-1.xml',
      itemIdentifier: 'item-1',
      comment: '',
      status: 200,
    });

    await textarea.fill('');
    await expect(textarea).toHaveValue('');

    const response = await saveResponse;
    expect(response.status()).toBe(200);

    await expect(
      page.getByTestId('save-status-assessmentResult-1.xml-item-1-comment'),
    ).toContainText('保存しました');

    // After reload the seed value should be gone, and the transient save
    // status indicator should be absent (the page re-renders without it
    // until the next save).
    await page.reload();
    await expect(page.getByLabel('コメント')).toHaveValue('');
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
    const saveComment = waitForResultsUpdate(page, {
      workspaceId,
      resultFile: 'assessmentResult-1.xml',
      itemIdentifier: 'item-1',
      comment: 'Exported comment',
      status: 200,
    });

    await textarea.fill('Exported comment');
    await expect(textarea).toHaveValue('Exported comment');

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

test('comment autosaves without blur and persists after reload', async ({ page }) => {
  await withWorkspace(page, 'E2E Comment Autosave', async (workspaceId) => {
    const textarea = page.getByLabel('コメント');
    await expect(textarea).toBeVisible();

    const saveResponse = waitForResultsUpdate(page, {
      workspaceId,
      resultFile: 'assessmentResult-1.xml',
      itemIdentifier: 'item-1',
      comment: 'Autosaved comment',
      status: 200,
    });

    await textarea.fill('Autosaved comment');
    await expect(textarea).toHaveValue('Autosaved comment');

    const response = await saveResponse;
    expect(response.status()).toBe(200);

    await expect(
      page.getByTestId('save-status-assessmentResult-1.xml-item-1-comment')
    ).toContainText('保存しました');

    await page.reload();
    await expect(page.getByLabel('コメント')).toHaveValue('Autosaved comment');
  });
});

test('comment autosave debounces rapid typing', async ({ page }) => {
  await withWorkspace(page, 'E2E Comment Autosave Debounce', async (workspaceId) => {
    let finalPutCount = 0;

    page.on('request', (request) => {
      if (request.method() !== 'PUT') return;
      if (!request.url().includes(`/api/workspaces/${workspaceId}/results`)) return;

      const body = request.postDataJSON() as {
        resultFile?: string;
        items?: Array<{ identifier?: string; comment?: string }>;
      };

      if (
        body.resultFile === 'assessmentResult-1.xml' &&
        body.items?.some((item) => item.identifier === 'item-1' && item.comment === 'Rapid autosave')
      ) {
        finalPutCount += 1;
      }
    });

    const textarea = page.getByLabel('コメント');

    const saveResponse = waitForResultsUpdate(page, {
      workspaceId,
      resultFile: 'assessmentResult-1.xml',
      itemIdentifier: 'item-1',
      comment: 'Rapid autosave',
      status: 200,
    });

    await textarea.fill('');
    await textarea.pressSequentially('Rapid autosave', { delay: 20 });

    expect((await saveResponse).status()).toBe(200);
    await page.waitForTimeout(500);

    expect(finalPutCount).toBe(1);
  });
});

test('comment autosave retries after a temporary failure', async ({ page }) => {
  await withWorkspace(page, 'E2E Comment Autosave Retry', async (workspaceId) => {
    let matchedAttemptCount = 0;

    await page.route(`**/api/workspaces/${workspaceId}/results`, async (route) => {
      const request = route.request();

      if (request.method() === 'PUT') {
        const body = request.postDataJSON() as {
          resultFile?: string;
          items?: Array<{ identifier?: string; comment?: string }>;
        };

        const isTarget =
          body.resultFile === 'assessmentResult-1.xml' &&
          body.items?.some(
            (item) => item.identifier === 'item-1' && item.comment === 'Retry autosave'
          );

        if (isTarget) {
          matchedAttemptCount += 1;

          if (matchedAttemptCount === 1) {
            await route.fulfill({
              status: 500,
              contentType: 'application/json',
              body: JSON.stringify({ error: 'temporary failure' }),
            });
            return;
          }
        }
      }

      await route.fallback();
    });

    const textarea = page.getByLabel('コメント');

    const successfulRetry = waitForResultsUpdate(page, {
      workspaceId,
      resultFile: 'assessmentResult-1.xml',
      itemIdentifier: 'item-1',
      comment: 'Retry autosave',
      status: 200,
    });

    await textarea.fill('Retry autosave');

    await expect(
      page.getByTestId('save-status-assessmentResult-1.xml-item-1-comment')
    ).toContainText(/保存中|保存を再試行中/);

    expect((await successfulRetry).status()).toBe(200);
    expect(matchedAttemptCount).toBeGreaterThanOrEqual(2);

    await expect(
      page.getByTestId('save-status-assessmentResult-1.xml-item-1-comment')
    ).toContainText('保存しました');

    await page.reload();
    await expect(page.getByLabel('コメント')).toHaveValue('Retry autosave');
  });
});

test('comment autosave keeps the saved flash when blurred with the same value mid-save', async ({
  page,
}) => {
  await withWorkspace(page, 'E2E Comment Autosave Blur Same', async (workspaceId) => {
    let putCount = 0;
    let signalInflight: () => void = () => {};
    const inflight = new Promise<void>((resolve) => {
      signalInflight = resolve;
    });

    // Hold the first matching PUT response open so the blur below is guaranteed
    // to fire while the save is still in flight. This is the exact race the
    // regression targets: a same-value blur must not spawn a redundant re-save
    // nor suppress the "保存しました" success flash.
    await page.route(`**/api/workspaces/${workspaceId}/results`, async (route) => {
      const request = route.request();
      if (request.method() === 'PUT') {
        const body = request.postDataJSON() as {
          resultFile?: string;
          items?: Array<{ identifier?: string; comment?: string }>;
        };
        const isTarget =
          body.resultFile === 'assessmentResult-1.xml' &&
          body.items?.some(
            (item) => item.identifier === 'item-1' && item.comment === 'Blur same value'
          );
        if (isTarget) {
          putCount += 1;
          signalInflight();
          await new Promise((resolve) => setTimeout(resolve, 700));
        }
      }
      await route.fallback();
    });

    const textarea = page.getByLabel('コメント');
    await textarea.fill('Blur same value');

    // Wait until the (held) save PUT is actually in flight, then blur with the
    // unchanged value.
    await inflight;
    await textarea.blur();

    await expect(
      page.getByTestId('save-status-assessmentResult-1.xml-item-1-comment')
    ).toContainText('保存しました');

    // Allow time for any erroneous re-save to fire before asserting the count.
    await page.waitForTimeout(800);
    expect(putCount).toBe(1);

    await page.reload();
    await expect(page.getByLabel('コメント')).toHaveValue('Blur same value');
  });
});

test('comment autosave warns before internal navigation while save is pending', async ({ page }) => {
  await withWorkspace(page, 'E2E Comment Autosave Internal Navigation Guard', async (workspaceId) => {
    let releaseSave: () => void = () => {};
    let signalInflight: () => void = () => {};
    const saveInflight = new Promise<void>((resolve) => {
      signalInflight = resolve;
    });
    const saveRelease = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });

    await page.route(`**/api/workspaces/${workspaceId}/results`, async (route) => {
      const request = route.request();

      if (request.method() === 'PUT') {
        const body = request.postDataJSON() as {
          resultFile?: string;
          items?: Array<{ identifier?: string; comment?: string }>;
        };

        const isTarget =
          body.resultFile === 'assessmentResult-1.xml' &&
          body.items?.some(
            (item) => item.identifier === 'item-1' && item.comment === 'Navigation guard comment'
          );

        if (isTarget) {
          signalInflight();
          await saveRelease;
        }
      }

      await route.fallback();
    });

    const textarea = page.getByLabel('コメント');
    await textarea.fill('Navigation guard comment');

    await saveInflight;

    page.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message()).toContain('コメントを保存中です');
      await dialog.dismiss();
    });

    await page.getByRole('button', { name: 'ワークスペース一覧に戻る' }).click();

    await expect(page).toHaveURL(new RegExp(`/workspace/${workspaceId}(?:\\?.*)?$`));

    releaseSave();

    await expect(
      page.getByTestId('save-status-assessmentResult-1.xml-item-1-comment')
    ).toContainText('保存しました');

    await page.reload();
    await expect(page.getByLabel('コメント')).toHaveValue('Navigation guard comment');
  });
});
