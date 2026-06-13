import { expect, test } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { createWorkspace, deleteWorkspace, waitForResultsUpdate } from './utils/workspace';

// Regression coverage for fix #3 (cloze SCORE-only display). All three
// scenarios share the same assessment-cloze fixture (rubric max = 1 + 2 = 3)
// and only mutate the itemResult SCORE / RUBRIC_n_MET outcomes in the
// per-workspace copy of assessmentResult-cloze-1.xml before navigating.
//
// The base fixture is assessmentResult-cloze-1.xml: SCORE=0, no
// RUBRIC_n_MET, sequenceIndex=1, itemResult identifier "item-1", rubric
// max = 3.

const setItemResultScore = async (resultPath: string, nextScore: number) => {
  const original = await fs.promises.readFile(resultPath, 'utf-8');
  // The base fixture has exactly one itemResult <outcomeVariable
  // identifier="SCORE" baseType="float"><value>0</value>...</outcomeVariable>.
  // (The testResult SCORE carries the cardinality attribute, so the regex
  // below leaves it untouched.)
  const updated = original.replace(
    /(<outcomeVariable identifier="SCORE" baseType="float">\s*<value>)0(<\/value>)/,
    `$1${nextScore}$2`
  );
  if (updated === original) {
    throw new Error(`failed to inject itemResult SCORE=${nextScore} into ${resultPath}`);
  }
  await fs.promises.writeFile(resultPath, updated, 'utf-8');
};

const addRubricMet = async (resultPath: string, criterionIndex: number) => {
  const original = await fs.promises.readFile(resultPath, 'utf-8');
  const updated = original.replace(
    /<outcomeVariable identifier="SCORE" baseType="float">\s*<value>\d+<\/value>\s*<\/outcomeVariable>/,
    (match) =>
      `${match}\n    <outcomeVariable identifier="RUBRIC_${criterionIndex}_MET" baseType="boolean"><value>true</value></outcomeVariable>`
  );
  if (updated === original) {
    throw new Error(`failed to inject RUBRIC_${criterionIndex}_MET into ${resultPath}`);
  }
  await fs.promises.writeFile(resultPath, updated, 'utf-8');
};

const locateResultPath = async (workspaceId: string) => {
  const workspaceDir = path.join(process.cwd(), 'data', 'workspaces', workspaceId);
  return path.join(workspaceDir, 'results', 'assessmentResult-cloze-1.xml');
};

test.describe('cloze SCORE-only display (fix #3)', () => {
  test('A: full-score SCORE-only cloze shows ○ from first render (no PUT)', async ({ page }) => {
    const workspaceId = await createWorkspace(
      page,
      'E2E Cloze Score Only Display - Full',
      'assessmentResult-cloze-1.xml',
      'assessment-cloze'
    );

    try {
      const resultPath = await locateResultPath(workspaceId);
      // Promote the itemResult SCORE to the rubric maximum (3) and leave
      // every RUBRIC_n_MET absent so the server is forced to infer the
      // full-true state on the very first render.
      await setItemResultScore(resultPath, 3);

      await page.goto(`/workspace/${workspaceId}`);
      await expect(page.getByRole('heading', { name: 'E2E Cloze Item' })).toBeVisible();

      // No PUT was issued; the inference must produce the locked (○) state
      // for both criteria from the very first render.
      await expect(page.getByText('正答から誤答には変更できません')).toHaveCount(2);
      await expect(page.getByRole('button', { name: '正答に変更' })).toHaveCount(0);
      await expect(page.getByText('現在: ×')).toHaveCount(0);
      await expect(page.getByText('現在: 未判定')).toHaveCount(0);

      // The item-mode view prints "得点: <score> / <max>" per candidate.
      // Both criteria are inferred true → score = rubric max = 3.
      await expect(page.getByText(/得点:\s*3\s*\/\s*3/)).toBeVisible();
    } finally {
      await deleteWorkspace(page, workspaceId);
    }
  });

  test('B: partial-score SCORE-only cloze shows 未判定 and an upgrade persists', async ({ page }) => {
    const workspaceId = await createWorkspace(
      page,
      'E2E Cloze Score Only Display - Partial',
      'assessmentResult-cloze-1.xml',
      'assessment-cloze'
    );

    try {
      const resultPath = await locateResultPath(workspaceId);
      // Partial: 1 point short of the 3-point rubric max. No RUBRIC_n_MET.
      // Inference MUST NOT run for partial scores, so both criteria must
      // show "未判定" and offer an "正答に変更" button.
      await setItemResultScore(resultPath, 2);

      await page.goto(`/workspace/${workspaceId}`);
      await expect(page.getByRole('heading', { name: 'E2E Cloze Item' })).toBeVisible();

      // Sanity: nothing is rendered as a wrong answer, and both criteria
      // are explicitly undetermined (one badge per criterion).
      await expect(page.getByText('現在: ×')).toHaveCount(0);
      await expect(page.getByText('現在: 未判定')).toHaveCount(2);

      // Two upgrade buttons — one per criterion.
      const upgradeButtons = page.getByRole('button', { name: '正答に変更' });
      await expect(upgradeButtons).toHaveCount(2);

      // Click the first one and wait for the PUT to land.
      const putResponse = waitForResultsUpdate(page);
      await upgradeButtons.first().click();
      const response = await putResponse;
      expect(response.status()).toBe(200);

      const body = (await response.json()) as {
        items?: Array<{
          identifier: string;
          rubricOutcomes: Record<number, boolean>;
        }>;
      };
      expect(body.items?.[0]?.identifier).toBe('item-1');
      // The first criterion was upgraded to true; the second was NOT asked
      // for, so it stays undefined (not inferred) on this file because the
      // saved SCORE is no longer the rubric max after the partial upgrade
      // round-trips with the explicit criterion 1: true.
      expect(body.items?.[0]?.rubricOutcomes[1]).toBe(true);
      expect(body.items?.[0]?.rubricOutcomes[2]).toBeUndefined();

      // Reload and verify the GUI reads the upgraded state back correctly:
      // the first criterion is locked, the second is still undetermined.
      await page.reload();
      await expect(page.getByRole('heading', { name: 'E2E Cloze Item' })).toBeVisible();

      const firstCriterion = page.getByText('[1] Capital is correct').locator('..');
      await expect(firstCriterion.getByText('正答から誤答には変更できません')).toBeVisible();
      await expect(firstCriterion.getByRole('button', { name: '正答に変更' })).toHaveCount(0);

      const secondCriterion = page.getByText('[2] Capital is correctly spelled').locator('..');
      await expect(secondCriterion.getByText('現在: 未判定')).toBeVisible();
      await expect(secondCriterion.getByRole('button', { name: '正答に変更' })).toHaveCount(1);
    } finally {
      await deleteWorkspace(page, workspaceId);
    }
  });

  test('C: partial-score SCORE-only with one explicit true shows ○ + 未判定', async ({ page }) => {
    const workspaceId = await createWorkspace(
      page,
      'E2E Cloze Score Only Display - SomeTrue',
      'assessmentResult-cloze-1.xml',
      'assessment-cloze'
    );

    try {
      const resultPath = await locateResultPath(workspaceId);
      // Partial (1 of 3) and criterion 1 is explicitly true. Criterion 2
      // is undefined. Inference must NOT run (some RUBRIC_n_MET is present)
      // and the GUI must render ○ for criterion 1 and 未判定 for criterion 2.
      await setItemResultScore(resultPath, 1);
      await addRubricMet(resultPath, 1);

      await page.goto(`/workspace/${workspaceId}`);
      await expect(page.getByRole('heading', { name: 'E2E Cloze Item' })).toBeVisible();

      // Criterion 1 is explicitly true: locked message, no upgrade button,
      // not 未判定, not ×.
      const firstCriterion = page.getByText('[1] Capital is correct').locator('..');
      await expect(firstCriterion.getByText('正答から誤答には変更できません')).toBeVisible();
      await expect(firstCriterion.getByRole('button', { name: '正答に変更' })).toHaveCount(0);
      await expect(firstCriterion.getByText('現在: 未判定')).toHaveCount(0);
      await expect(firstCriterion.getByText('現在: ×')).toHaveCount(0);

      // Criterion 2 is undefined: undetermined badge, upgrade button.
      const secondCriterion = page.getByText('[2] Capital is correctly spelled').locator('..');
      await expect(secondCriterion.getByText('現在: 未判定')).toBeVisible();
      await expect(secondCriterion.getByRole('button', { name: '正答に変更' })).toHaveCount(1);

      // No × / 誤答 anywhere — even with a partial score, the GUI must not
      // present an undefined criterion as a wrong answer.
      await expect(page.getByText('現在: ×')).toHaveCount(0);

      // Exactly ONE upgrade button (only the undetermined criterion).
      await expect(page.getByRole('button', { name: '正答に変更' })).toHaveCount(1);
    } finally {
      await deleteWorkspace(page, workspaceId);
    }
  });
});
