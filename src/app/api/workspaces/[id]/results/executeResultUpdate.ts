import type { AssessmentItemRef } from 'qti-xml-core';
import type {
  BuildResultUpdateResponseInput,
  ResultUpdateResponse,
} from '@/app/api/workspaces/[id]/results/response';

export interface ExecuteResultUpdateInput {
  resultPath: string;
  assessmentTestPath: string;
  scoringPath: string;
  preserveMet?: boolean;
  fileName: string;
  requestedIdentifiers: string[];
}

export interface ExecuteResultUpdateDependencies {
  applyQtiResultsUpdate: (args: {
    resultsPath: string;
    assessmentTestPath: string;
    scoringPath: string;
    preserveMet?: boolean;
  }) => Promise<string>;
  readAssessmentTestXml: (assessmentTestPath: string) => Promise<string>;
  parseAssessmentTestXml: (xml: string) => AssessmentItemRef[];
  buildResultUpdateResponse: (input: BuildResultUpdateResponseInput) => ResultUpdateResponse;
  updateResultXml: (workspaceDir: string, fileName: string, updatedXml: string) => Promise<void>;
  workspaceDir: string;
}

/**
 * Run the post-validation-prep half of the PUT /results pipeline:
 * apply QTI results → read the assessment-test → parse refs → build the
 * response (the validation step) → persist the updated XML.
 *
 * The route layer keeps the HTTP I/O and pre-validation work (path
 * sanitization, workspace lookup, tmp dir management). Everything from
 * `applyQtiResultsUpdate` onward is in here so tests can drive it via
 * dependency injection and assert the call order and failure modes
 * without any real filesystem or HTTP work.
 *
 * The contract is:
 *
 *  1. applyQtiResultsUpdate is called first.
 *  2. If it succeeds, readAssessmentTestXml + parseAssessmentTestXml
 *     follow.
 *  3. Then buildResultUpdateResponse runs. A throw from any of (1)-(4)
 *     propagates to the caller AND updateResultXml is NOT called.
 *  4. Only when (1)-(4) succeed does updateResultXml run. A throw from
 *     step 5 also propagates to the caller.
 *  5. The same `updatedXml` string from step 1 is the one that flows
 *     through to both `buildResultUpdateResponse` and `updateResultXml`,
 *     so the validator and the persister agree byte-for-byte.
 */
export const executeResultUpdate = async (
  input: ExecuteResultUpdateInput,
  dependencies: ExecuteResultUpdateDependencies
): Promise<ResultUpdateResponse> => {
  const updatedXml = await dependencies.applyQtiResultsUpdate({
    resultsPath: input.resultPath,
    assessmentTestPath: input.assessmentTestPath,
    scoringPath: input.scoringPath,
    preserveMet: input.preserveMet,
  });

  const assessmentTestXml = await dependencies.readAssessmentTestXml(input.assessmentTestPath);
  const assessmentTestRefs = dependencies.parseAssessmentTestXml(assessmentTestXml);

  const responseBody = dependencies.buildResultUpdateResponse({
    updatedXml,
    fileName: input.fileName,
    requestedIdentifiers: input.requestedIdentifiers,
    assessmentTestRefs,
  });

  await dependencies.updateResultXml(dependencies.workspaceDir, input.fileName, updatedXml);

  return responseBody;
};
