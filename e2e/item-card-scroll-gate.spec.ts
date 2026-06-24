import { test, expect } from '@playwright/test';
import path from 'path';
import {
  buildLargeAssessmentFixture,
  cleanupTrackedWorkspaces,
  withWorkspaceFromPaths,
} from './utils/workspace';
import { getTextareaMetrics, waitForTextareaToFitContent } from './utils/textarea';

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
      // taller. Use the helper so we assert on the implementation's
      // `style.height` against `scrollHeight + borderY` instead of the
      // browser-rounded `clientHeight`, which is sensitive to subpixel layout
      // and made the previous test flaky.
      const textarea = cardBefore.locator('textarea');
      await waitForTextareaToFitContent(textarea);
      const initialMetrics = await getTextareaMetrics(textarea);

      const expandedComment = [
        beforeComment,
        'extra line 1',
        'extra line 2',
        'extra line 3',
        'extra line 4',
        'extra line 5',
      ].join('\n');
      await textarea.fill(expandedComment);
      await expect(textarea).toHaveValue(expandedComment);
      await waitForTextareaToFitContent(textarea);

      const grownMetrics = await getTextareaMetrics(textarea);
      expect(grownMetrics.styleHeightPx).toBeGreaterThan(initialMetrics.styleHeightPx);
      expect(grownMetrics.scrollHeight).toBeGreaterThan(initialMetrics.scrollHeight);

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

test('showing the edge-scroll gate does not change the scroll content height', async ({
  page,
}, testInfo) => {
  const fixtureRoot = testInfo.outputPath('gate-overlay-fixture');
  const { assessmentDir, resultFiles } = await buildLargeAssessmentFixture(
    fixtureRoot,
    5
  );

  await withWorkspaceFromPaths(
    page,
    'E2E Gate Overlay',
    assessmentDir,
    resultFiles,
    async (workspaceId) => {
      await page.goto(`/workspace/${workspaceId}`);
      await expect(cardLocator(page)).toHaveCount(1);

      // Snap to the bottom edge and record the scroll height BEFORE the gate.
      const bottom = await scrollMetrics(page);
      await setScrollTop(page, bottom.scrollHeight);
      const beforeScrollHeight = (await scrollMetrics(page)).scrollHeight;

      // The first wheel opens the confirm gate (rendered as an overlay
      // OUTSIDE the scroll region).
      await scrollRegion(page).dispatchEvent('wheel', { deltaY: 100 });
      await expect(gateMessage(page)).toBeVisible();
      await expect(gateMessage(page)).toHaveAttribute('data-gate-kind', 'confirm');

      // The overlay must not push the scroll content taller; otherwise the
      // second wheel would read a fresh non-edge position and never navigate.
      const afterScrollHeight = (await scrollMetrics(page)).scrollHeight;
      expect(afterScrollHeight).toBe(beforeScrollHeight);

      // And the second wheel still advances the candidate.
      await page.waitForTimeout(220);
      await scrollRegion(page).dispatchEvent('wheel', { deltaY: 100 });
      await expect(cardCounter(page)).toContainText('受講者 2 / 5');
    }
  );
});

test('a real mouse wheel at the bottom edge advances to the next candidate', async ({
  page,
}, testInfo) => {
  // A small fixture is enough: the bug is about a single confirmed advance, so
  // we only need two candidates. Keeping it light avoids loading the dev
  // server when the rest of the suite runs in parallel.
  const fixtureRoot = testInfo.outputPath('mouse-wheel-fixture');
  const { assessmentDir, resultFiles } = await buildLargeAssessmentFixture(
    fixtureRoot,
    3
  );

  await withWorkspaceFromPaths(
    page,
    'E2E Mouse Wheel',
    assessmentDir,
    resultFiles,
    async (workspaceId) => {
      await page.goto(`/workspace/${workspaceId}`);
      await expect(cardCounter(page)).toContainText('受講者 1 / 3');

      // Pin to the bottom edge, then drive a real (not synthetic) wheel via
      // the Playwright mouse so we exercise the same code path a user hits.
      const metrics = await scrollMetrics(page);
      await setScrollTop(page, metrics.scrollHeight);

      // Hover the centre of the VISIBLE portion of the scroll region so the
      // trusted wheel event is delivered to it. The region is taller than the
      // viewport (max-h plus the toolbar above), so its geometric centre can
      // fall below the fold; clamp the target to the on-screen area.
      const box = await scrollRegion(page).boundingBox();
      if (!box) throw new Error('scroll region has no bounding box');
      const viewport = page.viewportSize();
      if (!viewport) throw new Error('no viewport size');
      const visibleTop = Math.max(box.y, 0);
      const visibleBottom = Math.min(box.y + box.height, viewport.height);
      const targetY = (visibleTop + visibleBottom) / 2;
      await page.mouse.move(box.x + box.width / 2, targetY);

      // First real wheel opens the confirm gate.
      await page.mouse.wheel(0, 100);
      await expect(gateMessage(page)).toBeVisible();
      await expect(cardCounter(page)).toContainText('受講者 1 / 3');

      // Second real wheel after the confirm delay advances the candidate.
      await page.waitForTimeout(220);
      await page.mouse.wheel(0, 100);
      await expect(cardCounter(page)).toContainText('受講者 2 / 3');
    }
  );
});
