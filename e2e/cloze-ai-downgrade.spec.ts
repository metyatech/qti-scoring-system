import { expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { createWorkspace, deleteWorkspace, waitForResultsUpdate } from './utils/workspace';

const resultPath = (workspaceId: string) =>
  path.join(process.cwd(), 'data', 'workspaces', workspaceId, 'results', 'assessmentResult-cloze-1.xml');

test('a cloze true outcome not present in the auto-grading baseline can be downgraded and saved', async ({
  page,
}) => {
  const workspaceId = await createWorkspace(
    page,
    'E2E Cloze AI Downgrade',
    'assessmentResult-cloze-1.xml',
    'assessment-cloze'
  );

  try {
    const currentResultPath = resultPath(workspaceId);
    const original = await fs.promises.readFile(currentResultPath, 'utf-8');
    const current = original
      .replace(
        /(<outcomeVariable identifier="SCORE" baseType="float">\s*<value>)0(<\/value>)/,
        (match) => match.replace('<value>0</value>', '<value>3</value>')
      )
      .replace(
        /<outcomeVariable identifier="SCORE" baseType="float">\s*<value>3<\/value>\s*<\/outcomeVariable>/,
        (match) =>
          `${match}\n    <outcomeVariable identifier="RUBRIC_1_MET" baseType="boolean"><value>true</value></outcomeVariable>\n    <outcomeVariable identifier="RUBRIC_2_MET" baseType="boolean"><value>true</value></outcomeVariable>`
      );
    if (current === original) throw new Error('failed to prepare AI/manual cloze result');

    const baselineDir = path.join(
      process.cwd(),
      'data',
      'workspaces',
      workspaceId,
      'auto-grading-results'
    );
    await fs.promises.mkdir(baselineDir, { recursive: true });
    await fs.promises.copyFile(
      path.join(process.cwd(), 'e2e', 'fixtures', 'results', 'assessmentResult-cloze-1.xml'),
      path.join(baselineDir, 'assessmentResult-cloze-1.xml')
    );
    await fs.promises.writeFile(currentResultPath, current, 'utf-8');

    await page.goto(`/workspace/${workspaceId}`);
    await expect(page.getByRole('heading', { name: 'E2E Cloze Item' })).toBeVisible();

    const firstCriterion = page.getByText('[1] Capital is correct').locator('..');
    await expect(firstCriterion.getByRole('button', { name: '×' })).toHaveCount(1);
    await expect(firstCriterion.getByText('正答から誤答には変更できません')).toHaveCount(0);

    const responsePromise = waitForResultsUpdate(page, {
      workspaceId,
      resultFile: 'assessmentResult-cloze-1.xml',
      itemIdentifier: 'item-1',
    });
    await firstCriterion.getByRole('button', { name: '×' }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);

    const body = (await response.json()) as {
      items?: Array<{ rubricOutcomes: Record<number, boolean>; score: number | null }>;
      testScore?: number | null;
    };
    expect(body.items?.[0]?.rubricOutcomes[1]).toBe(false);
    expect(body.items?.[0]?.rubricOutcomes[2]).toBe(true);
    expect(body.items?.[0]?.score).toBe(2);
    expect(body.testScore).toBe(2);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'E2E Cloze Item' })).toBeVisible();
    await expect(page.getByText(/得点:\s*2\s*\/\s*3/)).toBeVisible();
    await expect(firstCriterion.getByText('現在: ×')).toBeVisible();
    await expect(firstCriterion.getByRole('button', { name: '正答に変更' })).toHaveCount(1);

    const savedXml = await fs.promises.readFile(currentResultPath, 'utf-8');
    expect(savedXml).toMatch(
      /<outcomeVariable\s+identifier="RUBRIC_1_MET"[^>]*>\s*<value>false<\/value>\s*<\/outcomeVariable>/
    );
    expect(savedXml).toMatch(
      /<outcomeVariable\s+identifier="RUBRIC_2_MET"[^>]*>\s*<value>true<\/value>\s*<\/outcomeVariable>/
    );
    expect(savedXml).toMatch(
      /<itemResult[^>]*>\s*[\s\S]*?<outcomeVariable\s+identifier="SCORE"[^>]*>\s*<value>2<\/value>/
    );
  } finally {
    await deleteWorkspace(page, workspaceId);
  }
});
