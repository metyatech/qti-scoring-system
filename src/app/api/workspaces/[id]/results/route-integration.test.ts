import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildResultUpdateResponse } from '@/app/api/workspaces/[id]/results/response';
import { updateResultXml } from '@/lib/workspace';
import { parseAssessmentTestXml, parseQtiResultsXml } from '@/utils/qtiParsing';

// These tests exercise the persistence + byte-identical guarantees against the
// real filesystem. The call-order contract is owned by
// `result-update-pipeline.test.ts`.

const wrapResult = (itemResultXml: string, testScore: string | null = '0') => {
  const testScoreXml =
    testScore === null
      ? ''
      : `
    <outcomeVariable identifier="SCORE" cardinality="single" baseType="float">
      <value>${testScore}</value>
    </outcomeVariable>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<assessmentResult xmlns="http://www.imsglobal.org/xsd/imsqti_result_v3p0">
  <context sourcedId="e2e-user">
    <sessionIdentifier sourceID="candidateName" identifier="E2E User" />
    <sessionIdentifier sourceID="materialTitle" identifier="E2E Assessment" />
  </context>
  <testResult identifier="test-1" datestamp="2026-01-01T10:10:00+09:00">${testScoreXml}
  </testResult>
${itemResultXml}
</assessmentResult>`;
};

const assessmentTestXml = (...identifiers: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-test xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="assessment-test" title="Assessment">
  <qti-test-part identifier="part-1" navigation-mode="linear" submission-mode="individual">
    <qti-assessment-section identifier="section-1" title="Section 1" visible="true">
${identifiers
  .map((identifier) => `      <qti-assessment-item-ref identifier="${identifier}" href="${identifier}.xml"/>`)
  .join('\n')}
    </qti-assessment-section>
  </qti-test-part>
</qti-assessment-test>`;

const itemResult = ({
  identifier,
  sequenceIndex,
  score = 0,
}: {
  identifier: string;
  sequenceIndex?: number;
  score?: number;
}) => `
  <itemResult identifier="${identifier}"${sequenceIndex ? ` sequenceIndex="${sequenceIndex}"` : ''} datestamp="2026-01-01T10:10:00+09:00" sessionStatus="final">
    <responseVariable identifier="RESPONSE" cardinality="single" base-type="string">
      <candidateResponse><value>A</value></candidateResponse>
    </responseVariable>
    <outcomeVariable identifier="SCORE" baseType="float"><value>${score}</value></outcomeVariable>
  </itemResult>`;

const resultFile = 'assessmentResult-1.xml';
const originalXml = wrapResult(itemResult({ identifier: 'item-1', sequenceIndex: 1, score: 0 }), '0');
const updatedXml = wrapResult(
  `${itemResult({ identifier: 'item-1', sequenceIndex: 1, score: 1 })}
  <itemResult identifier="item-2" sequenceIndex="2" datestamp="2026-01-01T10:10:00+09:00" sessionStatus="final">
    <responseVariable identifier="RESPONSE" cardinality="single" base-type="string">
      <candidateResponse><value>B</value></candidateResponse>
    </responseVariable>
    <outcomeVariable identifier="SCORE" baseType="float"><value>2</value></outcomeVariable>
  </itemResult>`,
  '3'
);

let tempDirs: string[] = [];

const makeWorkspace = async (initialXml = originalXml) => {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'qti-result-route-'));
  tempDirs.push(workspaceDir);
  await mkdir(path.join(workspaceDir, 'results'));
  await writeFile(path.join(workspaceDir, 'results', resultFile), initialXml, 'utf-8');
  return workspaceDir;
};

const readSavedXml = (workspaceDir: string) =>
  readFile(path.join(workspaceDir, 'results', resultFile), 'utf-8');

const validateThenSave = async ({
  workspaceDir,
  xml,
  requestedIdentifiers,
  testXml,
}: {
  workspaceDir: string;
  xml: string;
  requestedIdentifiers: string[];
  testXml: string;
}) => {
  const assessmentTestRefs = parseAssessmentTestXml(testXml);
  const responseBody = buildResultUpdateResponse({
    updatedXml: xml,
    fileName: resultFile,
    requestedIdentifiers,
    assessmentTestRefs,
  });
  await updateResultXml(workspaceDir, resultFile, xml);
  return responseBody;
};

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe('results update real-file persistence (validate-before-write)', () => {
  it('writes updated XML only after response generation succeeds', async () => {
    const workspaceDir = await makeWorkspace();

    const response = await validateThenSave({
      workspaceDir,
      xml: updatedXml,
      requestedIdentifiers: ['item-1'],
      testXml: assessmentTestXml('item-1', 'item-2'),
    });

    expect(response).toMatchObject({ success: true, testScore: 3 });
    expect(response.items[0]).toMatchObject({ identifier: 'item-1', score: 1 });
    const savedXml = await readSavedXml(workspaceDir);
    expect(savedXml).toBe(updatedXml);
    expect(parseQtiResultsXml(savedXml, resultFile).itemResults['item-1'].score).toBe(1);
  });

  it('does not write when the requested identifier is absent from the assessment-test', async () => {
    const workspaceDir = await makeWorkspace();

    expect(() =>
      buildResultUpdateResponse({
        updatedXml: wrapResult(itemResult({ identifier: 'item-1', sequenceIndex: 1 }), '0'),
        fileName: resultFile,
        requestedIdentifiers: ['item-ghost'],
        assessmentTestRefs: parseAssessmentTestXml(assessmentTestXml('item-1')),
      })
    ).toThrow(/requested identifier "item-ghost" is not an item/);
    expect(await readSavedXml(workspaceDir)).toBe(originalXml);
  });

  it('does not write when the requested identifier has no itemResult', async () => {
    const workspaceDir = await makeWorkspace();

    expect(() =>
      buildResultUpdateResponse({
        updatedXml: wrapResult(itemResult({ identifier: 'item-1', sequenceIndex: 1 }), '0'),
        fileName: resultFile,
        requestedIdentifiers: ['item-2'],
        assessmentTestRefs: parseAssessmentTestXml(assessmentTestXml('item-1', 'item-2')),
      })
    ).toThrow(/requested identifier "item-2" was not saved/);
    expect(await readSavedXml(workspaceDir)).toBe(originalXml);
  });

  it('does not write when an itemResult cannot be remapped to an assessment item', async () => {
    const workspaceDir = await makeWorkspace();

    expect(() =>
      buildResultUpdateResponse({
        updatedXml: wrapResult(itemResult({ identifier: 'orphan', sequenceIndex: 99 }), '0'),
        fileName: resultFile,
        requestedIdentifiers: ['item-1'],
        assessmentTestRefs: parseAssessmentTestXml(assessmentTestXml('item-1', 'item-2')),
      })
    ).toThrow(/could not be matched to any assessment item/);
    expect(await readSavedXml(workspaceDir)).toBe(originalXml);
  });

  it('does not write when two itemResults map to the same assessment item', async () => {
    const workspaceDir = await makeWorkspace();
    const duplicateXml = wrapResult(
      `${itemResult({ identifier: 'Q1', sequenceIndex: 1, score: 1 })}
${itemResult({ identifier: 'item-1', sequenceIndex: 1, score: 2 })}`,
      '3'
    );

    expect(() =>
      buildResultUpdateResponse({
        updatedXml: duplicateXml,
        fileName: resultFile,
        requestedIdentifiers: ['item-1'],
        assessmentTestRefs: parseAssessmentTestXml(assessmentTestXml('item-1')),
      })
    ).toThrow(/multiple itemResults mapped to the same assessment item/);
    expect(await readSavedXml(workspaceDir)).toBe(originalXml);
  });

  it('does not write when assessment-test parsing fails', async () => {
    const workspaceDir = await makeWorkspace();

    expect(() => parseAssessmentTestXml('<qti-assessment-test><broken></qti-assessment-test>')).toThrow();
    expect(await readSavedXml(workspaceDir)).toBe(originalXml);
  });

  const itUnlessWindows = process.platform === 'win32' ? it.skip : it;
  itUnlessWindows(
    'surfaces updateResultXml failure after response generation without changing the saved file',
    async () => {
      const workspaceDir = await makeWorkspace();
      const resultsDir = path.join(workspaceDir, 'results');
      const response = buildResultUpdateResponse({
        updatedXml,
        fileName: resultFile,
        requestedIdentifiers: ['item-1'],
        assessmentTestRefs: parseAssessmentTestXml(assessmentTestXml('item-1', 'item-2')),
      });
      expect(response.success).toBe(true);

      await chmod(resultsDir, 0o500);
      try {
        await expect(updateResultXml(workspaceDir, resultFile, updatedXml)).rejects.toThrow();
      } finally {
        await chmod(resultsDir, 0o700);
      }
      expect(await readSavedXml(workspaceDir)).toBe(originalXml);
    }
  );
});
