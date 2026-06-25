import fs from 'fs/promises';
import path from 'path';
import type { APIRequestContext, Page } from '@playwright/test';

const createdWorkspaceIds = new Set<string>();

const assessRoot = path.join(process.cwd(), 'e2e', 'fixtures', 'assessment-multi');

const stripAssessmentExtension = (name: string) =>
  name.replace(/\.assessment-test\.qti\.xml$/i, '');

const renderLongItem2 = (candidate: string) => `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="item-2" title="E2E Item B" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string" />
  <qti-item-body>
    <qti-p>Explain item B in detail for ${candidate}.</qti-p>
    <qti-extended-text-interaction response-identifier="RESPONSE" />
    <qti-rubric-block view="scorer">
      <qti-p>[1] Mentions key point</qti-p>
    </qti-rubric-block>
  </qti-item-body>
</qti-assessment-item>
`;

const renderLongItem1 = () => `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="item-1" title="E2E Item A" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string" />
  <qti-item-body>
    <qti-p>Explain item A.</qti-p>
    <qti-extended-text-interaction response-identifier="RESPONSE" />
    <qti-rubric-block view="scorer">
      <qti-p>[1] Provides any answer</qti-p>
      <qti-p>[2] Explains reasoning</qti-p>
    </qti-rubric-block>
  </qti-item-body>
</qti-assessment-item>
`;

const renderAssessmentTest = () => `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-test xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="assessment-test" title="E2E Test Multi">
  <qti-test-part identifier="part-1" navigation-mode="linear" submission-mode="individual">
    <qti-assessment-section identifier="section-1" title="Section 1" visible="true">
      <qti-assessment-item-ref identifier="item-1" href="item-1.qti.xml"/>
      <qti-assessment-item-ref identifier="item-2" href="item-2.qti.xml"/>
    </qti-assessment-section>
  </qti-test-part>
</qti-assessment-test>
`;

const buildResultsXml = (index: number, comment: string) => {
  const padded = String(index + 1).padStart(2, '0');
  const candidate = `E2E User ${padded}`;
  const sourcedId = `e2e-user-${padded}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<assessmentResult xmlns="http://www.imsglobal.org/xsd/imsqti_result_v3p0">
  <context sourcedId="${sourcedId}">
    <sessionIdentifier sourceID="candidateName" identifier="${candidate}" />
    <sessionIdentifier sourceID="materialTitle" identifier="E2E Assessment" />
  </context>
  <testResult identifier="test-1" datestamp="2026-01-01T10:10:00+09:00">
    <outcomeVariable identifier="SCORE" cardinality="single" baseType="float">
      <value>0</value>
    </outcomeVariable>
  </testResult>
  <itemResult identifier="item-1" sequenceIndex="1" datestamp="2026-01-01T10:10:00+09:00" sessionStatus="final">
    <responseVariable identifier="RESPONSE" cardinality="single" baseType="string">
      <candidateResponse><value>Answer ${padded}A1 with extra padding to grow the textarea ${padded}</value></candidateResponse>
    </responseVariable>
    <outcomeVariable identifier="SCORE" baseType="float">
      <value>0</value>
    </outcomeVariable>
  </itemResult>
  <itemResult identifier="item-2" sequenceIndex="2" datestamp="2026-01-01T10:10:00+09:00" sessionStatus="final">
    <responseVariable identifier="RESPONSE" cardinality="single" baseType="string">
      <candidateResponse><value>Long answer body for ${candidate}: paragraph one explaining the solution, paragraph two restating the question, paragraph three providing an example, paragraph four concluding the answer with reasoning, paragraph five closing with the final stance, paragraph six wrapping up the explanation with a longer draft to make sure the candidate card scrolls.</value></candidateResponse>
    </responseVariable>
    <outcomeVariable identifier="SCORE" baseType="float">
      <value>0</value>
    </outcomeVariable>
    <outcomeVariable identifier="COMMENT" cardinality="single" baseType="string">
      <value>${comment}</value>
    </outcomeVariable>
  </itemResult>
</assessmentResult>
`;
};

export const createWorkspaceFromPaths = async (
  page: Page,
  name: string,
  assessmentDir: string,
  resultFilePaths: string[]
): Promise<string> => {
  await page.goto('/workspace/new');
  await page.getByLabel('ワークスペース名 *').fill(name);

  const assessmentInput = page.locator('input[type="file"]').nth(0);
  await assessmentInput.setInputFiles(assessmentDir);

  const resultsInput = page.locator('input[type="file"]').nth(1);
  await resultsInput.setInputFiles(resultFilePaths);

  const createResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/workspaces')
  );
  await page.getByRole('button', { name: 'ワークスペースを作成' }).click();
  const response = await createResponse;
  if (!response.ok()) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error ?? `workspace create failed: ${response.status()}`);
  }
  await page.waitForURL(/\/workspace\/(?!new$).+/);

  const url = new URL(page.url());
  const parts = url.pathname.split('/').filter(Boolean);
  const workspaceId = parts[1];
  if (!workspaceId || workspaceId === 'new') {
    throw new Error(`workspaceId not found in url: ${url.toString()}`);
  }
  createdWorkspaceIds.add(workspaceId);
  return workspaceId;
};

export const withWorkspaceFromPaths = async (
  page: Page,
  name: string,
  assessmentDir: string,
  resultFilePaths: string[],
  run: (workspaceId: string) => Promise<void>
) => {
  const workspaceId = await createWorkspaceFromPaths(page, name, assessmentDir, resultFilePaths);
  try {
    await run(workspaceId);
  } finally {
    await deleteWorkspace(page, workspaceId);
  }
};

/**
 * Build a fresh assessment directory and result files under `root`. Returns
 * the assessment directory and the array of result file paths.
 *
 * `resultCount` controls how many candidate Results Reporting XML files
 * are produced. The first candidate carries a long comment on item-2 so the
 * E2E can verify that the comment survives candidate switching.
 */
export const buildLargeAssessmentFixture = async (
  root: string,
  resultCount: number
): Promise<{ assessmentDir: string; resultFiles: string[] }> => {
  const assessmentDir = path.join(root, 'assessment');
  await fs.mkdir(assessmentDir, { recursive: true });
  await fs.writeFile(path.join(assessmentDir, 'assessment-test.qti.xml'), renderAssessmentTest());
  await fs.writeFile(path.join(assessmentDir, 'item-1.qti.xml'), renderLongItem1());

  const resultDir = path.join(root, 'results');
  await fs.mkdir(resultDir, { recursive: true });
  const resultFiles: string[] = [];
  for (let index = 0; index < resultCount; index += 1) {
    const padded = String(index + 1).padStart(2, '0');
    const candidate = `E2E User ${padded}`;
    const fileName = `assessmentResult-multi-${padded}.xml`;
    const filePath = path.join(resultDir, fileName);
    const comment =
      index === 0
        ? `Draft comment for ${candidate}: line one\nline two with rationale\nline three closing`
        : `Initial comment for ${candidate}`;
    await fs.writeFile(path.join(assessmentDir, 'item-2.qti.xml'), renderLongItem2(candidate));
    await fs.writeFile(filePath, buildResultsXml(index, comment));
    resultFiles.push(filePath);
  }
  // item-2.qti.xml is shared across candidates; we wrote the last value above.
  // Ensure the on-disk copy reflects a single item (the renderer does not
  // depend on candidate-specific content beyond the placeholders).
  await fs.writeFile(path.join(assessmentDir, 'item-2.qti.xml'), renderLongItem2('shared'));
  return { assessmentDir, resultFiles };
};

export const createWorkspace = async (
  page: Page,
  name: string,
  resultsFiles: string | string[] = 'assessmentResult-1.xml',
  assessmentFolder = 'assessment'
) => {
  await page.goto('/workspace/new');
  await page.getByLabel('ワークスペース名 *').fill(name);

  const assessmentInput = page.locator('input[type="file"]').nth(0);
  await assessmentInput.setInputFiles(path.join(process.cwd(), 'e2e', 'fixtures', assessmentFolder));

  const resultsInput = page.locator('input[type="file"]').nth(1);
  const resolvedResultsFiles = Array.isArray(resultsFiles) ? resultsFiles : [resultsFiles];
  await resultsInput.setInputFiles(
    resolvedResultsFiles.map((file) => path.join(process.cwd(), 'e2e', 'fixtures', 'results', file))
  );

  const createResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/workspaces')
  );
  await page.getByRole('button', { name: 'ワークスペースを作成' }).click();
  const response = await createResponse;
  if (!response.ok()) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error ?? `workspace create failed: ${response.status()}`);
  }
  await page.waitForURL(/\/workspace\/(?!new$).+/);

  const url = new URL(page.url());
  const parts = url.pathname.split('/').filter(Boolean);
  const workspaceId = parts[1];
  if (!workspaceId || workspaceId === 'new') {
    throw new Error(`workspaceId not found in url: ${url.toString()}`);
  }
  createdWorkspaceIds.add(workspaceId);
  return workspaceId;
};

export const deleteWorkspace = async (page: Page, workspaceId: string) => {
  await page.request.delete(`/api/workspaces/${workspaceId}`);
};

export const cleanupTrackedWorkspaces = async (request: APIRequestContext) => {
  if (createdWorkspaceIds.size === 0) return;
  const ids = Array.from(createdWorkspaceIds);
  createdWorkspaceIds.clear();
  await Promise.all(ids.map((id) => request.delete(`/api/workspaces/${id}`)));
};

export const withWorkspace = async (
  page: Page,
  name: string,
  run: (workspaceId: string) => Promise<void>,
  resultsFiles?: string | string[],
  assessmentFolder?: string
) => {
  const workspaceId = await createWorkspace(page, name, resultsFiles, assessmentFolder);
  try {
    await run(workspaceId);
  } finally {
    await deleteWorkspace(page, workspaceId);
  }
};

export type WaitForResultsUpdateOptions = {
  workspaceId?: string;
  resultFile?: string;
  itemIdentifier?: string;
  comment?: string;
  status?: number;
};

export const waitForResultsUpdate = (
  page: Page,
  options: WaitForResultsUpdateOptions = {}
) =>
  page.waitForResponse((response) => {
    const request = response.request();
    if (request.method() !== 'PUT') return false;

    const url = response.url();
    if (options.workspaceId) {
      if (!url.includes(`/api/workspaces/${options.workspaceId}/results`)) return false;
    } else if (!url.includes('/api/workspaces/') || !url.includes('/results')) {
      return false;
    }

    if (options.status !== undefined && response.status() !== options.status) {
      return false;
    }

    if (!options.resultFile && !options.itemIdentifier && options.comment === undefined) {
      return true;
    }

    try {
      const body = request.postDataJSON() as {
        resultFile?: string;
        items?: Array<{ identifier?: string; comment?: string }>;
      };

      if (options.resultFile && body.resultFile !== options.resultFile) return false;

      if (options.itemIdentifier || options.comment !== undefined) {
        return Boolean(
          body.items?.some((item) => {
            if (options.itemIdentifier && item.identifier !== options.itemIdentifier) return false;
            if (options.comment !== undefined && item.comment !== options.comment) return false;
            return true;
          })
        );
      }

      return true;
    } catch {
      return false;
    }
  });

// Suppress unused import warnings: keep `assessRoot` and
// `stripAssessmentExtension` exported in case future tests need them.
export const __assessRoot = assessRoot;
export const __stripAssessmentExtension = stripAssessmentExtension;
