import { expect, test } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { withWorkspace, waitForResultsUpdate } from './utils/workspace';

// ---------------------------------------------------------------------------
// E2E coverage for the PUT /api/workspaces/:id/results pipeline.
//
// These tests previously existed only in the completion report; the
// orchestrator never landed them. They are part of the "fix" delta for
// the review follow-up, so the assertion contracts documented in the
// review notes are pinned here, against a real running dev server.
//
// E2E 1 — invalid PUT 500 leaves the production Results XML byte-identical
// E2E 2 — PUT 500 rolls back the optimistic UI and leaves the file untouched
// E2E 3 — partial-score SCORE never drops below the explicit value during PUT
// ---------------------------------------------------------------------------

const resultFilePath = (workspaceId: string, resultFile: string) =>
  path.join(process.cwd(), 'data', 'workspaces', workspaceId, 'results', resultFile);

const listResultsDir = async (workspaceId: string) => {
  const dir = path.join(process.cwd(), 'data', 'workspaces', workspaceId, 'results');
  try {
    return await fs.promises.readdir(dir);
  } catch {
    return [] as string[];
  }
};

test('invalid PUT 500 leaves the production Results XML byte-identical', async ({ page }) => {
  const resultFile = 'assessmentResult-cloze-1.xml';
  await withWorkspace(
    page,
    'E2E Invalid PUT Byte-Identical',
    async (workspaceId) => {
      const resultPath = resultFilePath(workspaceId, resultFile);
      const before = await fs.promises.readFile(resultPath);

      // Drive a real PUT from the browser context with a payload that will
      // fail server-side validation: "item-ghost" is not in the assessment-test.
      const response = await page.evaluate(
        async ({ id, resultFile: rf }) => {
          const res = await fetch(`/api/workspaces/${id}/results`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              resultFile: rf,
              items: [{ identifier: 'item-ghost', criteria: [{ met: true }] }],
            }),
          });
          return { status: res.status, body: await res.text() };
        },
        { id: workspaceId, resultFile }
      );
      expect(response.status).toBe(500);

      const after = await fs.promises.readFile(resultPath);
      expect(Buffer.compare(before, after)).toBe(0);

      // Reload and verify the on-screen rubric state is still untouched:
      // criterion 1 still offers the upgrade button, criterion 2 still
      // offers the upgrade button, no lock message anywhere.
      await page.goto(`/workspace/${workspaceId}`);
      await expect(page.getByRole('heading', { name: 'E2E Cloze Item' })).toBeVisible();
      await expect(page.getByText('正答から誤答には変更できません')).toHaveCount(0);
      await expect(page.getByRole('button', { name: '正答に変更' })).toHaveCount(2);

      // The results/ directory must contain only the original XML; no stray
      // .bak or .tmp file from a partial write.
      const entries = await listResultsDir(workspaceId);
      const nonXml = entries.filter((name) => name !== resultFile);
      expect(nonXml).toEqual([]);
    },
    resultFile,
    'assessment-cloze'
  );
});

test('PUT 500 with route.fulfill rolls back the optimistic UI and leaves the file untouched', async ({
  page,
}) => {
  const resultFile = 'assessmentResult-cloze-1.xml';
  await withWorkspace(
    page,
    'E2E PUT 500 Optimistic Rollback',
    async (workspaceId) => {
      const resultPath = resultFilePath(workspaceId, resultFile);
      const before = await fs.promises.readFile(resultPath);

      await page.goto(`/workspace/${workspaceId}`);
      await expect(page.getByRole('heading', { name: 'E2E Cloze Item' })).toBeVisible();

      // The fixture starts with SCORE=0, no RUBRIC_n_MET. The optimistic
      // helper therefore shows 0 for the current item. The first criterion
      // is what we want to click. The default view is item-mode, so the
      // score renders as `得点: <score> / <max>` in each result card.
      const itemScore = page.locator('text=得点:').first();
      await expect(itemScore).toBeVisible();
      const beforeScoreText = await itemScore.textContent();
      expect(beforeScoreText).toContain('0');

      // Intercept the PUT and force a 500.
      await page.route('**/api/workspaces/*/results', (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'forced' }),
        })
      );

      // Click the first "正答に変更" button. The optimistic update
      // temporarily flips the rubric to { 1: true, 2: undefined } and
      // (because the SCORE is 0 with no RUBRIC outcomes, getItemScore
      // returns 0 via the explicit-SCORE branch) the score would briefly
      // still show 0 if the optimistic state stuck. The 500 must roll it
      // back.
      const firstUpgrade = page.getByRole('button', { name: '正答に変更' }).first();
      await firstUpgrade.click();

      // The error message must be surfaced in the page. The frontend
      // throws the body.error string from the server (here: "forced").
      await expect(page.getByText('forced', { exact: true })).toBeVisible();

      // Rollback: the original upgrade button is re-rendered for the
      // first criterion, no locked message anywhere.
      await expect(page.getByRole('button', { name: '正答に変更' })).toHaveCount(2);
      await expect(page.getByText('正答から誤答には変更できません')).toHaveCount(0);

      // The score display returns to the original "0 / 3" value.
      const afterScoreText = await itemScore.textContent();
      expect(afterScoreText).toContain('0');

      // The saved XML must be byte-identical: no RUBRIC_n_MET added, no
      // SCORE rewrite, no .bak left behind.
      const after = await fs.promises.readFile(resultPath, 'utf-8');
      expect(after).toBe(before.toString('utf-8'));
      expect(after).not.toMatch(/RUBRIC_(\d+)_MET/);

      const entries = await listResultsDir(workspaceId);
      const nonXml = entries.filter((name) => name !== resultFile);
      expect(nonXml).toEqual([]);
    },
    resultFile,
    'assessment-cloze'
  );
});

test('partial-score SCORE never drops below the explicit value during the PUT (optimistic hold)', async ({
  page,
}) => {
  const resultFile = 'assessmentResult-cloze-partial-1.xml';
  await withWorkspace(
    page,
    'E2E Partial Score Optimistic Hold',
    async (workspaceId) => {
      await page.goto(`/workspace/${workspaceId}`);
      await expect(page.getByRole('heading', { name: 'E2E Cloze Partial Item' })).toBeVisible();

      // The fixture starts with itemResult SCORE=2 and no RUBRIC_n_MET;
      // getItemScore returns 2 (cloze + numeric explicit SCORE +
      // incomplete rubric → keep SCORE). The default view is item-mode,
      // so the score renders as `得点: <score> / <max>` in each result card.
      const itemScore = page.locator('text=得点:').first();
      await expect(itemScore).toBeVisible();
      await expect(itemScore).toContainText('2');

      // Hold the PUT response behind a deferred Promise so we can observe
      // the optimistic intermediate state deterministically.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route('**/api/workspaces/*/results', async (route) => {
        await gate;
        await route.continue();
      });

      const reqPromise = page.waitForRequest(
        (request) =>
          request.method() === 'PUT' &&
          request.url().includes(`/api/workspaces/${workspaceId}/results`)
      );
      const respPromise = waitForResultsUpdate(page);

      // Click "正答に変更" on the 1-point criterion. The optimistic
      // helper must keep the displayed score at 2 (NOT drop to 1 or 0)
      // because the saved itemResult has an explicit numeric SCORE and
      // the rubric outcomes are incomplete.
      await page.getByRole('button', { name: '正答に変更' }).first().click();
      await reqPromise;

      // Intermediate state: the score must still be 2.
      await expect(itemScore).toContainText('2');

      release();
      const response = await respPromise;
      expect(response.status()).toBe(200);

      // Post-PUT: the score must remain 2 (apply-to-qti-results keeps
      // existingScoreScaled when itemScoreScaled < existingScoreScaled,
      // so the upgrade to met=true on the 1pt criterion cannot lower
      // the saved SCORE below 2).
      await expect(itemScore).toContainText('2');

      // Reload and confirm the saved value round-trips.
      await page.reload();
      await expect(page.getByRole('heading', { name: 'E2E Cloze Partial Item' })).toBeVisible();
      const reloadedScore = page.locator('text=得点:').first();
      await expect(reloadedScore).toContainText('2');

      // The saved itemResult SCORE is still ≥ 2.
      const resultPath = resultFilePath(workspaceId, resultFile);
      const savedXml = await fs.promises.readFile(resultPath, 'utf-8');
      const scoreMatch = savedXml.match(
        /<itemResult[^>]*>\s*[\s\S]*?<outcomeVariable\s+identifier="SCORE"[^>]*>\s*<value>([\d.]+)<\/value>/
      );
      expect(scoreMatch).not.toBeNull();
      const savedScore = Number(scoreMatch?.[1]);
      expect(Number.isFinite(savedScore)).toBe(true);
      expect(savedScore).toBeGreaterThanOrEqual(2);
    },
    resultFile,
    'assessment-cloze-partial'
  );
});
