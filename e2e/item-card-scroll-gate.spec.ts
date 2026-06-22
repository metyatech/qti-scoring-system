import { test, expect } from '@playwright/test';
import path from 'path';
import {
  buildLargeAssessmentFixture,
  cleanupTrackedWorkspaces,
  withWorkspaceFromPaths,
} from './utils/workspace';

test.afterEach(async ({ page }) => {
  await cleanupTrackedWorkspaces(page.request);
});

const RESULT_COUNT = 41;

const scrollRegion = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid="item-card-scroll-region"]');

const cardLocator = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid="item-candidate-card"]');

const gateMessage = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid="edge-scroll-gate-message"]');

const cardCounter = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid="item-card-candidate-counter"]');

const setScrollTop = async (
  page: import('@playwright/test').Page,
  value: number
) => {
  await scrollRegion(page).evaluate((node, scrollValue) => {
    (node as HTMLDivElement).scrollTop = scrollValue;
  }, value);
};

const scrollMetrics = async (page: import('@playwright/test').Page) => {
  return scrollRegion(page).evaluate((node) => {
    const el = node as HTMLDivElement;
    return {
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    };
  });
};

/**
 * Trigger the scroll-gate end-to-end to advance by exactly one candidate.
 * Drives the production wheel handler (not a synthetic state change) so
 * the textarea-blur-on-navigate path is exercised.
 */
const advanceOneCandidate = async (page: import('@playwright/test').Page) => {
  const metrics = await scrollMetrics(page);
  await setScrollTop(page, metrics.scrollHeight);
  await scrollRegion(page).dispatchEvent('wheel', { deltaY: 100 });
  await page.waitForTimeout(220);
  await scrollRegion(page).dispatchEvent('wheel', { deltaY: 100 });
};

const jumpToLastCandidate = async (
  page: import('@playwright/test').Page,
  total: number
) => {
  for (let i = 1; i < total; i += 1) {
    await advanceOneCandidate(page);
  }
};

const jumpToFirstCandidate = async (
  page: import('@playwright/test').Page,
  total: number
) => {
  for (let i = 1; i < total; i += 1) {
    await setScrollTop(page, 0);
    await scrollRegion(page).dispatchEvent('wheel', { deltaY: -100 });
    await page.waitForTimeout(220);
    await scrollRegion(page).dispatchEvent('wheel', { deltaY: -100 });
  }
};

test('item view renders a single card and the edge-scroll gate swaps candidates', async ({
  page,
}, testInfo) => {
  const fixtureRoot = testInfo.outputPath('scroll-gate-fixture');
  const { assessmentDir, resultFiles } = await buildLargeAssessmentFixture(
    fixtureRoot,
    RESULT_COUNT
  );

  await withWorkspaceFromPaths(
    page,
    'E2E Scroll Gate',
    assessmentDir,
    resultFiles,
    async (workspaceId) => {
      await page.goto(`/workspace/${workspaceId}`);

      // The item view should be the default and only show a single card.
      await expect(cardLocator(page)).toHaveCount(1);
      await expect(cardCounter(page)).toContainText('受講者 1 / 41');
      await expect(page.getByText(`E2E User 01`)).toBeVisible();

      // Scroll to mid-card; the candidate must NOT change.
      await setScrollTop(page, 50);
      await scrollRegion(page).dispatchEvent('wheel', { deltaY: 100 });
      await expect(cardCounter(page)).toContainText('受講者 1 / 41');
      await expect(cardLocator(page)).toHaveCount(1);

      // Snap to the bottom edge and scroll further down. The first wheel
      // shows the confirm message but does not advance.
      const bottomMetrics = await scrollMetrics(page);
      await setScrollTop(page, bottomMetrics.scrollHeight);
      await scrollRegion(page).dispatchEvent('wheel', { deltaY: 100 });

      const confirm = gateMessage(page);
      await expect(confirm).toBeVisible();
      await expect(confirm).toHaveAttribute('data-gate-kind', 'confirm');
      await expect(confirm).toContainText('次の受講者へ進むには、もう一度スクロール');
      await expect(cardCounter(page)).toContainText('受講者 1 / 41');

      // The second wheel after MIN_CONFIRM_DELAY_MS advances the candidate
      // and resets the scroll region to the top.
      await page.waitForTimeout(220);
      await scrollRegion(page).dispatchEvent('wheel', { deltaY: 100 });

      await expect(cardCounter(page)).toContainText('受講者 2 / 41');
      await expect(cardLocator(page)).toHaveCount(1);
      const scrolled = await scrollMetrics(page);
      expect(scrolled.scrollTop).toBe(0);
      await expect(gateMessage(page)).toHaveCount(0);

      // Scroll to top and exercise the previous direction.
      await setScrollTop(page, 0);
      await scrollRegion(page).dispatchEvent('wheel', { deltaY: -100 });

      const prevConfirm = gateMessage(page);
      await expect(prevConfirm).toBeVisible();
      await expect(prevConfirm).toHaveAttribute('data-gate-direction', 'previous');
      await expect(prevConfirm).toContainText('前の受講者へ戻るには、もう一度スクロール');

      await page.waitForTimeout(220);
      await scrollRegion(page).dispatchEvent('wheel', { deltaY: -100 });
      await expect(cardCounter(page)).toContainText('受講者 1 / 41');

      // At the first candidate, scrolling up should not loop but show a
      // boundary message.
      await setScrollTop(page, 0);
      await scrollRegion(page).dispatchEvent('wheel', { deltaY: -100 });
      const boundary = gateMessage(page);
      await expect(boundary).toBeVisible();
      await expect(boundary).toHaveAttribute('data-gate-kind', 'boundary');
      await expect(boundary).toContainText('最初の受講者です');
      await expect(cardCounter(page)).toContainText('受講者 1 / 41');

      // Jump to the last candidate by repeatedly triggering the scroll-gate
      // navigation. Driving it through the wheel events is the production
      // code path; we only need a couple of flicks per candidate.
      await jumpToLastCandidate(page, RESULT_COUNT);

      await expect(cardCounter(page)).toContainText(`受講者 ${RESULT_COUNT} / ${RESULT_COUNT}`);

      // At the last candidate, scrolling down must show a boundary message
      // instead of looping to the first.
      const lastMetrics = await scrollMetrics(page);
      await setScrollTop(page, lastMetrics.scrollHeight);
      await scrollRegion(page).dispatchEvent('wheel', { deltaY: 100 });
      const lastBoundary = gateMessage(page);
      await expect(lastBoundary).toBeVisible();
      await expect(lastBoundary).toContainText('最後の受講者です');
      await expect(cardCounter(page)).toContainText(`受講者 ${RESULT_COUNT} / ${RESULT_COUNT}`);

      // Move back to candidate 1 so the textarea part of the test can run
      // against the candidate whose initial comment is the long one.
      await jumpToFirstCandidate(page, RESULT_COUNT);
      await expect(cardCounter(page)).toContainText('受講者 1 / 41');

      // Switch to candidate 2 to verify the comment from candidate 1 does
      // not leak into candidate 2's textarea. The default view shows item-1
      // (which has no seeded comment), so move to item-2 first where the
      // first candidate carries a long initial comment.
      await page.getByRole('button', { name: '次 →' }).click();
      await expect(page.getByText('問2:')).toBeVisible();
      const cardBefore = cardLocator(page);
      const beforeComment = await cardBefore.locator('textarea').inputValue();
      expect(beforeComment).toContain('Draft comment for E2E User 01');

      // Type extra text into candidate 1's comment to make the textarea
      // taller.
      const textarea = cardBefore.locator('textarea');
      const initialHeight = await textarea.evaluate((el) => el.clientHeight);
      await textarea.fill(beforeComment + '\nextra line 1\nextra line 2\nextra line 3');
      await expect
        .poll(async () => textarea.evaluate((el) => el.clientHeight), {
          timeout: 5000,
        })
        .toBeGreaterThan(initialHeight);

      // Confirm the auto-resize is satisfied for input-driven growth.
      const afterFillHeight = await textarea.evaluate((el) => el.clientHeight);
      expect(afterFillHeight).toBeGreaterThan(initialHeight);

      // Advance to candidate 2 via the scroll gate end-to-end so we also
      // exercise that path here (covers textarea blur on navigation).
      await advanceOneCandidate(page);

      await expect(cardCounter(page)).toContainText('受講者 2 / 41');

      const cardAfter = cardLocator(page);
      const afterComment = await cardAfter.locator('textarea').inputValue();
      expect(afterComment).not.toContain('extra line');
      expect(afterComment).toContain('Initial comment for E2E User 02');

      // Only a single card is mounted at any time.
      await expect(cardLocator(page)).toHaveCount(1);
    }
  );

  // The fixture directory is recreated per test run; nothing further to do.
});

test('item card scroll gate survives ctrlKey wheel events (zoom passthrough)', async ({
  page,
}, testInfo) => {
  const fixtureRoot = testInfo.outputPath('ctrlkey-fixture');
  const { assessmentDir, resultFiles } = await buildLargeAssessmentFixture(
    fixtureRoot,
    3
  );

  await withWorkspaceFromPaths(
    page,
    'E2E Scroll Gate CtrlKey',
    assessmentDir,
    resultFiles,
    async (workspaceId) => {
      await page.goto(`/workspace/${workspaceId}`);
      await expect(cardLocator(page)).toHaveCount(1);

      // Wheel events with ctrlKey are browser-zoom shortcuts; the gate
      // must not swallow them.
      const bottomMetrics = await scrollMetrics(page);
      await setScrollTop(page, bottomMetrics.scrollHeight);
      await scrollRegion(page).dispatchEvent('wheel', {
        deltaY: 100,
        ctrlKey: true,
      });
      await expect(gateMessage(page)).toHaveCount(0);
      await expect(cardCounter(page)).toContainText('受講者 1 / 3');
    }
  );

  // fixture path referenced to keep helper tree-shaking honest.
  expect(path.basename(fixtureRoot)).toMatch(/ctrlkey-fixture$/);
});
