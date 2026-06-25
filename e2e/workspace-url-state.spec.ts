import { test, expect } from '@playwright/test';
import {
  buildLargeAssessmentFixture,
  cleanupTrackedWorkspaces,
  withWorkspace,
  withWorkspaceFromPaths,
} from './utils/workspace';

test.afterEach(async ({ page }) => {
  await cleanupTrackedWorkspaces(page.request);
});

test('workspace URL query restores item view state after reload', async ({
  page,
}, testInfo) => {
  const fixtureRoot = testInfo.outputPath('url-state-restore');
  const { assessmentDir, resultFiles } = await buildLargeAssessmentFixture(fixtureRoot, 3);

  await withWorkspaceFromPaths(
    page,
    'E2E URL State Restore',
    assessmentDir,
    resultFiles,
    async (workspaceId) => {
      await page.goto(
        `/workspace/${workspaceId}?view=item&result=assessmentResult-multi-02.xml&item=item-2&details=1`
      );

      // The page must mount the requested item in item view, not the default.
      await expect(page.getByText('問2: E2E Item B')).toBeVisible();
      await expect(page.getByTestId('item-card-candidate-counter')).toContainText(
        '受講者 2 / 3'
      );
      await expect(page.getByText('identifier:')).toBeVisible();
      await expect(page.getByText('item-2')).toBeVisible();

      // The URL must reflect the active state. Order is not asserted; we
      // only verify the canonical stable keys survive.
      {
        const params = new URL(page.url()).searchParams;
        expect(params.get('view')).toBe('item');
        expect(params.get('result')).toBe('assessmentResult-multi-02.xml');
        expect(params.get('item')).toBe('item-2');
        expect(params.get('details')).toBe('1');
      }

      await page.reload();

      await expect(page.getByText('問2: E2E Item B')).toBeVisible();
      await expect(page.getByTestId('item-card-candidate-counter')).toContainText(
        '受講者 2 / 3'
      );
      await expect(page.getByText('identifier:')).toBeVisible();

      const params = new URL(page.url()).searchParams;
      expect(params.get('view')).toBe('item');
      expect(params.get('result')).toBe('assessmentResult-multi-02.xml');
      expect(params.get('item')).toBe('item-2');
      expect(params.get('details')).toBe('1');
    }
  );
});

test('workspace UI navigation updates URL query without adding history entries', async ({
  page,
}, testInfo) => {
  const fixtureRoot = testInfo.outputPath('url-state-ui');
  const { assessmentDir, resultFiles } = await buildLargeAssessmentFixture(fixtureRoot, 3);

  await withWorkspaceFromPaths(
    page,
    'E2E URL State UI',
    assessmentDir,
    resultFiles,
    async (workspaceId) => {
      await page.goto(`/workspace/${workspaceId}`);

      // Wait for the initial canonical query to settle.
      await expect(page.getByText('問1: E2E Item A')).toBeVisible();
      {
        const params = new URL(page.url()).searchParams;
        expect(params.get('view')).toBe('item');
        expect(params.get('result')).toBe('assessmentResult-multi-01.xml');
        expect(params.get('item')).toBe('item-1');
        expect(params.has('details')).toBe(false);
      }

      // Capture history length so we can prove "次へ" / "受講者ごと" do not
      // grow the browser history. `replaceState` is the contract; if a code
      // change ever swaps it for `pushState`, this assertion will fail.
      const baselineHistoryLength = await page.evaluate(() => window.history.length);

      await page.getByRole('button', { name: '次 →' }).click();
      await expect(page.getByText('問2: E2E Item B')).toBeVisible();
      {
        const params = new URL(page.url()).searchParams;
        expect(params.get('view')).toBe('item');
        expect(params.get('item')).toBe('item-2');
        expect(params.get('result')).toBe('assessmentResult-multi-01.xml');
      }

      await page.getByRole('button', { name: '受講者ごと' }).click();
      // Candidate 1 is mounted after switching modes. The header shows the
      // candidate name in a bold gray-800 div; the same string also appears
      // inside response bodies / comments, so we pin to the header element.
      await expect(
        page.locator('div.text-xl.font-bold', { hasText: 'E2E User 01' })
      ).toBeVisible();
      {
        const params = new URL(page.url()).searchParams;
        expect(params.get('view')).toBe('candidate');
        expect(params.get('result')).toBe('assessmentResult-multi-01.xml');
        expect(params.get('item')).toBe('item-2');
      }

      await page.getByRole('button', { name: '次 →' }).click();
      await expect(
        page.locator('div.text-xl.font-bold', { hasText: 'E2E User 02' })
      ).toBeVisible();
      {
        const params = new URL(page.url()).searchParams;
        expect(params.get('view')).toBe('candidate');
        expect(params.get('result')).toBe('assessmentResult-multi-02.xml');
      }

      await page.getByRole('button', { name: '詳細を表示' }).click();
      await expect(page.getByText('sourcedId:')).toBeVisible();
      {
        const params = new URL(page.url()).searchParams;
        expect(params.get('details')).toBe('1');
      }

      await page.getByRole('button', { name: '詳細を隠す' }).click();
      await expect(page.getByText('sourcedId:')).toBeHidden();
      {
        const params = new URL(page.url()).searchParams;
        expect(params.has('details')).toBe(false);
      }

      const finalHistoryLength = await page.evaluate(() => window.history.length);
      expect(finalHistoryLength).toBe(baselineHistoryLength);
    }
  );
});

test('workspace URL query ignores invalid state and canonicalizes to defaults', async ({
  page,
}) => {
  await withWorkspace(
    page,
    'E2E URL State Invalid',
    async (workspaceId) => {
      await page.goto(
        `/workspace/${workspaceId}?view=bad&result=missing.xml&item=missing&details=no`
      );

      // All four keys must be ignored. The page falls back to the default
      // item view at the only item (the default fixture has just item-1).
      // The page header shows "問1: E2E Item" and the URL rewrites to the
      // canonical item=item-1 / result=assessmentResult-1.xml state.
      await expect(page.getByText('問1: E2E Item')).toBeVisible();
      await expect(
        page.getByRole('button', { name: '詳細を表示' })
      ).toBeVisible();

      const params = new URL(page.url()).searchParams;
      expect(params.get('view')).toBe('item');
      expect(params.get('result')).toBe('assessmentResult-1.xml');
      expect(params.get('item')).toBe('item-1');
      expect(params.has('details')).toBe(false);
    },
    'assessmentResult-1.xml',
    'assessment'
  );
});
