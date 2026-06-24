import { expect, test } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { withWorkspace, waitForResultsUpdate } from './utils/workspace';

// Regression coverage for fix #4 (save-response identifier remapping).
//
// The fixture pair intentionally diverges the Results-side itemResult
// identifier from the assessment item identifier:
//
//   - assessment-test.qti.xml      : <qti-assessment-item-ref
//                                    identifier="question-source-id"
//                                    href="question-source-id.qti.xml"/>
//   - question-source-id.qti.xml   : <qti-assessment-item
//                                    identifier="question-source-id" ...>
//   - assessmentResult-remap-1.xml : <itemResult identifier="Q1"
//                                    sequenceIndex="1" ...>
//
// The frontend therefore has to remap "Q1" → "question-source-id" when it
// builds the PUT body, and the server has to remap "Q1" → "question-source-id"
// again when it parses the saved file back into the response. Both
// directions of the round-trip are exercised here.

const locateResultPath = async (workspaceId: string) => {
  const workspaceDir = path.join(process.cwd(), 'data', 'workspaces', workspaceId);
  return path.join(workspaceDir, 'results', 'assessmentResult-remap-1.xml');
};

test('cloze rubric upgrade PUTs under the remapped identifier and rewrites the saved XML', async ({
  page,
}) => {
  await withWorkspace(
    page,
    'E2E Remap Save Sync',
    async (workspaceId) => {
      await page.goto(`/workspace/${workspaceId}`);

      // The new assessment-remap fixture owns this item, so the cloze UI must
      // render the remap item heading and the rubric panel. The 採点基準
      // marker is a <div> (not a heading element), so use a text locator
      // rather than getByRole('heading', ...).
      await expect(page.getByRole('heading', { name: 'E2E Remap Item' })).toBeVisible();
      await expect(page.getByText('採点基準', { exact: true }).first()).toBeVisible();

      // The rubric has 2 criteria, each starts undetermined → 2 upgrade
      // buttons, no locked messages, no × anywhere.
      const upgradeButtons = page.getByRole('button', { name: '正答に変更' });
      await expect(upgradeButtons).toHaveCount(2);
      await expect(page.getByText('正答から誤答には変更できません')).toHaveCount(0);
      await expect(page.getByText('現在: ×')).toHaveCount(0);

      // Capture both the request and the response in parallel so we can
      // assert the request identifier (remapped by the client) and the
      // response identifier (remapped again by the server).
      const requestPromise = page.waitForRequest(
        (request) =>
          request.method() === 'PUT' &&
          request.url().includes(`/api/workspaces/${workspaceId}/results`)
      );
      const responsePromise = waitForResultsUpdate(page, {
        workspaceId,
        resultFile: 'assessmentResult-remap-1.xml',
        itemIdentifier: 'question-source-id',
      });

      await upgradeButtons.first().click();

      const request = await requestPromise;
      const response = await responsePromise;
      expect(response.status()).toBe(200);

      // The client must address the assessment item identifier, NOT the
      // legacy "Q1" identifier from the result XML.
      const requestBody = request.postDataJSON() as {
        items?: Array<{ identifier?: string; criteria?: Array<{ met?: boolean }> }>;
      };
      expect(requestBody.items).toHaveLength(1);
      expect(requestBody.items?.[0]?.identifier).toBe('question-source-id');
      expect(requestBody.items?.[0]?.identifier).not.toBe('Q1');
      // The first criterion is the one we clicked; the second is left alone.
      expect(requestBody.items?.[0]?.criteria?.[0]?.met).toBe(true);
      expect(requestBody.items?.[0]?.criteria?.[1]?.met).toBeFalsy();

      // The server response must NOT be sparse: every requested item comes
      // back with the remapped assessment item identifier and the rubric
      // outcomes the file actually holds. Criterion 1 just got upgraded;
      // criterion 2 was never asked for, so it stays undefined.
      const responseBody = (await response.json()) as {
        items?: Array<{
          identifier: string;
          rubricOutcomes: Record<number, boolean>;
          score?: number | null;
        }>;
        testScore?: number | null;
      };
      expect(responseBody.items).toHaveLength(1);
      expect(responseBody.items?.[0]?.identifier).toBe('question-source-id');
      expect(responseBody.items?.[0]?.identifier).not.toBe('Q1');
      expect(responseBody.items?.[0]?.rubricOutcomes[1]).toBe(true);
      // The full body must carry a numeric testScore, not null — proves the
      // remap path is producing a complete, authoritative response (the
      // rubric is 1+2=3 and the upgrade touches one criterion, so the
      // value is whatever apply-to-qti-results computes; we only require
      // it to be a finite, non-negative number).
      expect(typeof responseBody.testScore).toBe('number');
      expect(Number.isFinite(responseBody.testScore)).toBe(true);
      expect((responseBody.testScore as number) >= 0).toBe(true);

      // Post-PUT: criterion 1 was just upgraded, so it must show the locked
      // message and have lost its upgrade button. Criterion 2 is still
      // undetermined and must still offer an upgrade button.
      const firstCriterion = page.getByText('[1] Capital is correct').locator('..');
      await expect(firstCriterion.getByText('正答から誤答には変更できません')).toBeVisible();
      await expect(firstCriterion.getByRole('button', { name: '正答に変更' })).toHaveCount(0);

      const secondCriterion = page.getByText('[2] Capital is correctly spelled').locator('..');
      await expect(secondCriterion.getByRole('button', { name: '正答に変更' })).toHaveCount(1);

      // Reload — the value must round-trip from the saved file via the
      // remap path, not from in-memory state.
      await page.reload();
      await expect(page.getByRole('heading', { name: 'E2E Remap Item' })).toBeVisible();

      const reloadedFirst = page.getByText('[1] Capital is correct').locator('..');
      await expect(reloadedFirst.getByText('正答から誤答には変更できません')).toBeVisible();
      await expect(reloadedFirst.getByRole('button', { name: '正答に変更' })).toHaveCount(0);

      const reloadedSecond = page.getByText('[2] Capital is correctly spelled').locator('..');
      await expect(reloadedSecond.getByRole('button', { name: '正答に変更' })).toHaveCount(1);

      // Read the saved result file back from disk and confirm the upgrade
      // actually reached the file via the remap path. The original fixture
      // had <value>0</value> for the itemResult SCORE and no RUBRIC_1_MET
      // outcome at all. After the PUT, criterion 1 must be marked MET and
      // the itemResult SCORE must have been rewritten to a positive value
      // (apply-to-qti-results output, not the original 0).
      const resultPath = await locateResultPath(workspaceId);
      const savedXml = await fs.promises.readFile(resultPath, 'utf-8');
      expect(savedXml).toMatch(
        /<outcomeVariable\s+identifier="RUBRIC_1_MET"[^>]*>\s*<value>true<\/value>\s*<\/outcomeVariable>/
      );
      const itemScoreMatch = savedXml.match(
        /<itemResult[^>]*>\s*[\s\S]*?<outcomeVariable\s+identifier="SCORE"[^>]*>\s*<value>(\d+(?:\.\d+)?)<\/value>/
      );
      expect(itemScoreMatch).not.toBeNull();
      const savedScore = Number(itemScoreMatch?.[1]);
      expect(Number.isFinite(savedScore)).toBe(true);
      expect(savedScore).toBeGreaterThan(0);
    },
    'assessmentResult-remap-1.xml',
    'assessment-remap'
  );
});
