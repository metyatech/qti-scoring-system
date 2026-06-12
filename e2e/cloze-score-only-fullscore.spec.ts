import { expect, test } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { createWorkspace, deleteWorkspace } from './utils/workspace';

// Regression test for the SCORE-only full-score cloze bug: a cloze item that
// already holds the full rubric score but carries NO RUBRIC_n_MET outcomes must
// be treated as fully correct. Sending met:false from the GUI/API must never
// downgrade it to × — the score and every criterion stay true, and the page
// shows the locked "正答から誤答には変更できません" state after reload.
test('a full-score cloze item with no RUBRIC outcomes is never downgraded to ×', async ({
  page,
}) => {
  const workspaceId = await createWorkspace(
    page,
    'E2E Cloze Score Only Full',
    'assessmentResult-cloze-1.xml',
    'assessment-cloze'
  );

  try {
    const workspaceDir = path.join(process.cwd(), 'data', 'workspaces', workspaceId);
    const resultPath = path.join(workspaceDir, 'results', 'assessmentResult-cloze-1.xml');
    const original = await fs.promises.readFile(resultPath, 'utf-8');

    // Promote ONLY the itemResult SCORE (the testResult SCORE carries the
    // cardinality attribute, so this regex leaves it untouched) to the rubric
    // maximum (1 + 2 = 3) while leaving the item without any RUBRIC_n_MET
    // outcomes — the exact shape that previously produced a false downgrade.
    const fullScore = original.replace(
      /(<outcomeVariable identifier="SCORE" baseType="float">\s*<value>)0(<\/value>)/,
      `$13$2`
    );
    if (fullScore === original) {
      throw new Error('failed to inject full SCORE into the cloze result fixture');
    }
    await fs.promises.writeFile(resultPath, fullScore, 'utf-8');

    await page.goto(`/workspace/${workspaceId}`);
    await expect(page.getByRole('heading', { name: 'E2E Cloze Item' })).toBeVisible();

    // Drive the PUT directly with met:false for both criteria. The server must
    // infer the full-score item as all-correct and refuse the downgrade.
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
    expect(body.items?.[0]?.rubricOutcomes[2]).toBe(true);
    expect(body.items?.[0]?.score).toBe(3);
    expect(body.testScore).toBe(3);

    // Reload and confirm the GUI shows the locked (correct) state for both
    // criteria and never offers a downgrade / shows ×.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'E2E Cloze Item' })).toBeVisible();
    await expect(page.getByText('正答から誤答には変更できません')).toHaveCount(2);
    await expect(page.getByRole('button', { name: '正答に変更' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '×' })).toHaveCount(0);
  } finally {
    await deleteWorkspace(page, workspaceId);
  }
});
