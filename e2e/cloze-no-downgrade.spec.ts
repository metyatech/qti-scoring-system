import { expect, test } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { createWorkspace, deleteWorkspace } from './utils/workspace';

test('the server never downgrades a cloze criterion that is already true', async ({ page }) => {
  const workspaceId = await createWorkspace(
    page,
    'E2E Cloze No Downgrade',
    'assessmentResult-cloze-1.xml',
    'assessment-cloze'
  );

  try {
    // Find the result file the workspace just wrote and inject a forced
    // RUBRIC_1_MET=true so the fixture looks like an already-graded item.
    // We re-parse via the public workspace dir at runtime.
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
    const upgraded = original.replace(
      /<outcomeVariable identifier="SCORE" baseType="float">\s*<value>0<\/value>\s*<\/outcomeVariable>/,
      (match) => `${match}\n    <outcomeVariable identifier="RUBRIC_1_MET" baseType="boolean"><value>true</value></outcomeVariable>`
    );
    await fs.promises.writeFile(resultPath, upgraded, 'utf-8');

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
      items?: Array<{ rubricOutcomes: Record<number, boolean> }>;
    };
    expect(body.items?.[0]?.rubricOutcomes[1]).toBe(true);

    // Reload to confirm the saved file round-trips the same value.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'E2E Cloze Item' })).toBeVisible();
    await expect(page.getByText('正答から誤答には変更できません')).toBeVisible();
  } finally {
    await deleteWorkspace(page, workspaceId);
  }
});
