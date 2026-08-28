import { expect, test } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { createWorkspace, deleteWorkspace } from './utils/workspace';

test('the server protects only cloze criteria that were true in the auto-grading baseline', async ({ page }) => {
  const workspaceId = await createWorkspace(
    page,
    'E2E Cloze No Downgrade',
    'assessmentResult-cloze-1.xml',
    'assessment-cloze'
  );

  try {
    // The immutable provenance source is explicit in legacy-mode E2E tests.
    // It contains only criterion 1 as an auto-grading true outcome; the
    // current result is then made to look like an AI/manual result with both
    // criteria true. The current result must never be used as provenance.
    const workspaceDir = path.join(process.cwd(), 'data', 'workspaces', workspaceId);
    const workspaceMetaPath = path.join(workspaceDir, 'workspace.json');
    const meta = JSON.parse(await fs.promises.readFile(workspaceMetaPath, 'utf-8')) as {
      resultFiles: string[];
    };
    if (!meta.resultFiles.includes('assessmentResult-cloze-1.xml')) {
      throw new Error('expected result file missing from workspace meta');
    }
    const resultPath = path.join(workspaceDir, 'results', 'assessmentResult-cloze-1.xml');
    const original = await fs.promises.readFile(resultPath, 'utf-8');
    const baseline = original.replace(
      /(<outcomeVariable identifier="SCORE" baseType="float">\s*<value>)0(<\/value>)/,
      (match) => match.replace('<value>0</value>', '<value>1</value>')
    ).replace(
      /<outcomeVariable identifier="SCORE" baseType="float">\s*<value>1<\/value>\s*<\/outcomeVariable>/,
      (match) => `${match}\n    <outcomeVariable identifier="RUBRIC_1_MET" baseType="boolean"><value>true</value></outcomeVariable>`
    );
    const upgraded = original.replace(
      /<outcomeVariable identifier="SCORE" baseType="float">\s*<value>0<\/value>\s*<\/outcomeVariable>/,
      (match) => match.replace('<value>0</value>', '<value>3</value>')
        + '\n    <outcomeVariable identifier="RUBRIC_1_MET" baseType="boolean"><value>true</value></outcomeVariable>'
    );
    const current = upgraded.replace(
      /<outcomeVariable identifier="SCORE" baseType="float">\s*<value>3<\/value>\s*<\/outcomeVariable>/,
      (match) => `${match}\n    <outcomeVariable identifier="RUBRIC_2_MET" baseType="boolean"><value>true</value></outcomeVariable>`
    );
    if (baseline === original || upgraded === baseline || current === upgraded) {
      throw new Error('failed to prepare auto-grading and current cloze results');
    }
    const autoGradingResultsDir = path.join(workspaceDir, 'auto-grading-results');
    await fs.promises.mkdir(autoGradingResultsDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(autoGradingResultsDir, 'assessmentResult-cloze-1.xml'),
      baseline,
      'utf-8'
    );
    await fs.promises.writeFile(resultPath, current, 'utf-8');

    // The page loads first to make sure the file the server reports is
    // consistent. Then we drive the PUT directly via page.request with
    // met: false to confirm the server still keeps the criterion true.
    await page.goto(`/workspace/${workspaceId}`);
    await expect(page.getByRole('heading', { name: 'E2E Cloze Item' })).toBeVisible();

    const putResponse = await page.request.put(`/api/workspaces/${workspaceId}/results`, {
      data: {
        resultFile: 'assessmentResult-cloze-1.xml',
        items: [
          {
            identifier: 'item-1',
            criteria: [{ met: false }, { met: false }],
          },
        ],
      },
    });
    expect(putResponse.status()).toBe(200);

    const body = (await putResponse.json()) as {
      items?: Array<{ rubricOutcomes: Record<number, boolean>; score: number | null }>;
      testScore?: number | null;
    };
    expect(body.items?.[0]?.rubricOutcomes[1]).toBe(true);
    expect(body.items?.[0]?.rubricOutcomes[2]).toBe(false);
    expect(body.items?.[0]?.score).toBe(1);
    expect(body.testScore).toBe(1);

    // Reload to confirm the saved file round-trips the same value.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'E2E Cloze Item' })).toBeVisible();
    await expect(page.getByText('正答から誤答には変更できません')).toHaveCount(1);
    const protectedCriterion = page.getByText('[1] Capital is correct').locator('..');
    await expect(protectedCriterion.getByRole('button', { name: '×' })).toHaveCount(0);
    const nonProtectedCriterion = page.getByText('[2] Capital is correctly spelled').locator('..');
    await expect(nonProtectedCriterion.getByText('現在: ×')).toBeVisible();
    await expect(nonProtectedCriterion.getByRole('button', { name: '正答に変更' })).toHaveCount(1);
  } finally {
    await deleteWorkspace(page, workspaceId);
  }
});
