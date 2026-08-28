import { expect, test } from '@playwright/test';
import fs from 'fs/promises';
import path from 'path';
import { createWorkspace, deleteWorkspace } from './utils/workspace';

const resultFile = 'assessmentResult-multi-1.xml';

const resultPath = (workspaceId: string) =>
  path.join(process.cwd(), 'data', 'workspaces', workspaceId, 'results', resultFile);

test('preserveMet protects descriptive downgrades while normal review can correct them', async ({ page }) => {
  const workspaceId = await createWorkspace(
    page,
    'E2E Descriptive Preserve Met',
    resultFile,
    'assessment-multi'
  );

  try {
    const put = (data: { preserveMet?: boolean; met: boolean }) =>
      page.request.put(`/api/workspaces/${workspaceId}/results`, {
        data: {
          resultFile,
          items: [{ identifier: 'item-1', criteria: [{ met: data.met }, { met: false }] }],
          ...(data.preserveMet === undefined ? {} : { preserveMet: data.preserveMet }),
        },
      });

    const upgraded = await put({ met: true });
    expect(upgraded.status()).toBe(200);
    expect((await upgraded.json()).items[0].rubricOutcomes[1]).toBe(true);

    const preservedDowngrade = await put({ met: false, preserveMet: true });
    expect(preservedDowngrade.status()).toBe(200);
    expect((await preservedDowngrade.json()).items[0].rubricOutcomes[1]).toBe(true);

    const savedAfterPreserve = await fs.readFile(resultPath(workspaceId), 'utf-8');
    expect(savedAfterPreserve).toMatch(
      /<outcomeVariable\s+identifier="RUBRIC_1_MET"[^>]*>\s*<value>true<\/value>\s*<\/outcomeVariable>/
    );

    const normalDowngrade = await put({ met: false });
    expect(normalDowngrade.status()).toBe(200);
    expect((await normalDowngrade.json()).items[0].rubricOutcomes[1]).toBe(false);

    const savedAfterNormalReview = await fs.readFile(resultPath(workspaceId), 'utf-8');
    expect(savedAfterNormalReview).toMatch(
      /<outcomeVariable\s+identifier="RUBRIC_1_MET"[^>]*>\s*<value>false<\/value>\s*<\/outcomeVariable>/
    );
  } finally {
    await deleteWorkspace(page, workspaceId);
  }
});
