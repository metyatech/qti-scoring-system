import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { getAutoGradingProtectedCriteria } from '@/lib/autoGradingProtection';
import type { QtiWorkspace } from '@/types/qti';

const assessmentTestXml = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-test xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="assessment-test" title="Protection Test">
  <qti-test-part identifier="part-1" navigation-mode="linear" submission-mode="individual">
    <qti-assessment-section identifier="section-1" title="Section 1" visible="true">
      <qti-assessment-item-ref identifier="cloze-item" href="items/cloze-item.qti.xml" />
      <qti-assessment-item-ref identifier="descriptive-item" href="items/descriptive-item.qti.xml" />
      <qti-assessment-item-ref identifier="choice-item" href="items/choice-item.qti.xml" />
    </qti-assessment-section>
  </qti-test-part>
</qti-assessment-test>`;

const clozeItemXml = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="cloze-item" title="Cloze" adaptive="false" time-dependent="false">
  <qti-item-body>
    <p>Answer <qti-text-entry-interaction response-identifier="RESPONSE" />.</p>
    <qti-rubric-block view="scorer">
      <p>[1] First criterion</p>
      <p>[2] Second criterion</p>
    </qti-rubric-block>
  </qti-item-body>
</qti-assessment-item>`;

const descriptiveItemXml = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="descriptive-item" title="Descriptive" adaptive="false" time-dependent="false">
  <qti-item-body>
    <p>Explain.</p>
    <qti-extended-text-interaction response-identifier="RESPONSE" />
    <qti-rubric-block view="scorer"><p>[3] Explanation is complete</p></qti-rubric-block>
  </qti-item-body>
</qti-assessment-item>`;

const choiceItemXml = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="choice-item" title="Choice" adaptive="false" time-dependent="false">
  <qti-item-body>
    <qti-choice-interaction response-identifier="RESPONSE" max-choices="1">
      <qti-simple-choice identifier="A">A</qti-simple-choice>
    </qti-choice-interaction>
    <qti-rubric-block view="scorer"><p>[4] Choice is correct</p></qti-rubric-block>
  </qti-item-body>
</qti-assessment-item>`;

const resultsXml = (clozeOutcomes: string, clozeScore: number) => `<?xml version="1.0" encoding="UTF-8"?>
<assessmentResult xmlns="http://www.imsglobal.org/xsd/imsqti_result_v3p0">
  <context sourcedId="candidate-1" />
  <itemResult identifier="cloze-item" sequenceIndex="1">
    <outcomeVariable identifier="SCORE" baseType="float"><value>${clozeScore}</value></outcomeVariable>
    ${clozeOutcomes}
  </itemResult>
  <itemResult identifier="descriptive-item" sequenceIndex="2">
    <outcomeVariable identifier="RUBRIC_1_MET" baseType="boolean"><value>true</value></outcomeVariable>
  </itemResult>
  <itemResult identifier="choice-item" sequenceIndex="3">
    <outcomeVariable identifier="RUBRIC_1_MET" baseType="boolean"><value>true</value></outcomeVariable>
  </itemResult>
</assessmentResult>`;

const rubricOutcome = (index: number, value: boolean) =>
  `<outcomeVariable identifier="RUBRIC_${index}_MET" baseType="boolean"><value>${value}</value></outcomeVariable>`;

const workspace: QtiWorkspace = {
  id: 'protection-test',
  name: 'Protection test',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  itemFiles: [
    'items/cloze-item.qti.xml',
    'items/descriptive-item.qti.xml',
    'items/choice-item.qti.xml',
  ],
  assessmentTestFile: 'assessment-test.qti.xml',
  resultFiles: ['assessmentResult-1.xml'],
  itemCount: 3,
  resultCount: 1,
};

let tempRoots: string[] = [];

const setupIndexFixture = async (snapshotXml?: string) => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qti-protection-'));
  tempRoots.push(repoRoot);
  const workspaceRel = 'courses/javascript/exams/final/result/scoring-workspace';
  const workspaceDir = path.join(repoRoot, workspaceRel);
  const assessmentDir = path.join(workspaceDir, 'assessment');
  const currentResultsDir = path.join(workspaceDir, 'results');
  const snapshotDir = path.join(repoRoot, 'courses/javascript/exams/final/result/submissions/results');
  await fs.mkdir(path.join(assessmentDir, 'items'), { recursive: true });
  await fs.mkdir(currentResultsDir, { recursive: true });
  if (snapshotXml !== undefined) await fs.mkdir(snapshotDir, { recursive: true });
  await fs.writeFile(path.join(workspaceDir, 'workspace.json'), JSON.stringify(workspace), 'utf-8');
  await fs.writeFile(path.join(assessmentDir, 'assessment-test.qti.xml'), assessmentTestXml, 'utf-8');
  await fs.writeFile(path.join(assessmentDir, 'items/cloze-item.qti.xml'), clozeItemXml, 'utf-8');
  await fs.writeFile(path.join(assessmentDir, 'items/descriptive-item.qti.xml'), descriptiveItemXml, 'utf-8');
  await fs.writeFile(path.join(assessmentDir, 'items/choice-item.qti.xml'), choiceItemXml, 'utf-8');
  await fs.writeFile(path.join(currentResultsDir, 'assessmentResult-1.xml'), resultsXml(rubricOutcome(1, true), 1), 'utf-8');
  if (snapshotXml !== undefined) {
    await fs.writeFile(path.join(snapshotDir, 'assessmentResult-1.xml'), snapshotXml, 'utf-8');
  }
  const indexDir = path.join(repoRoot, '.course-assessment');
  await fs.mkdir(indexDir, { recursive: true });
  const indexPath = path.join(indexDir, 'scoring-workspace-index.json');
  await fs.writeFile(
    indexPath,
    JSON.stringify({ workspaces: [{ id: workspace.id, workspaceDir: workspaceRel }] }),
    'utf-8',
  );
  process.env.QTI_SCORING_SYSTEM_REPO_ROOT = repoRoot;
  process.env.QTI_SCORING_SYSTEM_WORKSPACE_INDEX = indexPath;
};

afterEach(async () => {
  delete process.env.QTI_SCORING_SYSTEM_REPO_ROOT;
  delete process.env.QTI_SCORING_SYSTEM_WORKSPACE_INDEX;
  await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
  tempRoots = [];
});

describe('auto-grading protection', () => {
  it('uses the index-mode snapshot and protects only true cloze criteria', async () => {
    await setupIndexFixture(resultsXml(`${rubricOutcome(1, true)}${rubricOutcome(2, false)}`, 1));

    await expect(getAutoGradingProtectedCriteria(workspace.id)).resolves.toEqual({
      'assessmentResult-1.xml': { 'cloze-item': [1] },
    });
  });

  it('uses effective full-score inference for a SCORE-only cloze snapshot', async () => {
    await setupIndexFixture(resultsXml('', 3));

    await expect(getAutoGradingProtectedCriteria(workspace.id)).resolves.toEqual({
      'assessmentResult-1.xml': { 'cloze-item': [1, 2] },
    });
  });

  it('fails closed when the index-mode snapshot directory is missing', async () => {
    await setupIndexFixture();

    await expect(getAutoGradingProtectedCriteria(workspace.id)).rejects.toThrow(
      '自動採点 snapshot ディレクトリが見つかりません',
    );
  });

  it('returns an empty map in legacy mode without the explicit fallback', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qti-protection-legacy-'));
    tempRoots.push(repoRoot);
    const workspaceDir = path.join(repoRoot, 'data', 'workspaces', workspace.id);
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.writeFile(path.join(workspaceDir, 'workspace.json'), JSON.stringify(workspace), 'utf-8');
    const previousCwd = process.cwd();
    process.chdir(repoRoot);
    try {
      await expect(getAutoGradingProtectedCriteria(workspace.id)).resolves.toEqual({});
    } finally {
      process.chdir(previousCwd);
    }
  });
});
