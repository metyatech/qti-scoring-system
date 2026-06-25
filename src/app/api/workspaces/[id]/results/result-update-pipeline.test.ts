import { describe, expect, it, vi } from 'vitest';
import type { AssessmentItemRef } from 'qti-xml-core';
import {
  executeResultUpdate,
  type ExecuteResultUpdateDependencies,
  type ExecuteResultUpdateInput,
} from './executeResultUpdate';
import type { ResultUpdateResponse } from './response';

// Canonical names used in the call-order assertion. Renaming here is fine;
// re-ordering the calls in executeResultUpdate.ts is not.
const STEP_NAMES = {
  apply: 'apply',
  readAssessment: 'read-assessment',
  parseAssessment: 'parse-assessment',
  validateResponse: 'validate-response',
  persist: 'persist',
} as const;

const buildInput = (): ExecuteResultUpdateInput => ({
  resultPath: '/tmp/results.xml',
  assessmentTestPath: '/tmp/assessment-test.xml',
  scoringPath: '/tmp/scoring.json',
  preserveMet: true,
  fileName: 'assessmentResult-1.xml',
  requestedIdentifiers: ['item-1'],
});

const buildHappyDependencies = (response: ResultUpdateResponse) => {
  const calls: string[] = [];
  const refs: AssessmentItemRef[] = [{ identifier: 'item-1', href: 'item-1.xml' }];
  const applyQtiResultsUpdate = vi.fn(async () => {
    calls.push(STEP_NAMES.apply);
    return '<updated/>';
  });
  const readAssessmentTestXml = vi.fn(async () => {
    calls.push(STEP_NAMES.readAssessment);
    return '<assessment-test/>';
  });
  const parseAssessmentTestXml = vi.fn(() => {
    calls.push(STEP_NAMES.parseAssessment);
    return refs;
  });
  const buildResultUpdateResponse = vi.fn(() => {
    calls.push(STEP_NAMES.validateResponse);
    return response;
  });
  const updateResultXml = vi.fn(async () => {
    calls.push(STEP_NAMES.persist);
  });
  return {
    dependencies: {
      applyQtiResultsUpdate,
      readAssessmentTestXml,
      parseAssessmentTestXml,
      buildResultUpdateResponse,
      updateResultXml,
      workspaceDir: '/workspaces/ws-1',
    } satisfies ExecuteResultUpdateDependencies,
    calls,
    applyQtiResultsUpdate,
    readAssessmentTestXml,
    parseAssessmentTestXml,
    buildResultUpdateResponse,
    updateResultXml,
  };
};

describe('executeResultUpdate pipeline', () => {
  it('happy path: dependencies run in the documented order with the right arguments and the return is forwarded unchanged', async () => {
    const response: ResultUpdateResponse = {
      success: true,
      items: [{ identifier: 'item-1', rubricOutcomes: { 1: true, 2: false }, score: 1, comment: null }],
      testScore: 1,
    };
    const built = buildHappyDependencies(response);
    const input = buildInput();

    const result = await executeResultUpdate(input, built.dependencies);

    expect(result).toBe(response);
    expect(built.calls).toEqual([
      STEP_NAMES.apply,
      STEP_NAMES.readAssessment,
      STEP_NAMES.parseAssessment,
      STEP_NAMES.validateResponse,
      STEP_NAMES.persist,
    ]);

    expect(built.applyQtiResultsUpdate).toHaveBeenCalledTimes(1);
    expect(built.readAssessmentTestXml).toHaveBeenCalledTimes(1);
    expect(built.parseAssessmentTestXml).toHaveBeenCalledTimes(1);
    expect(built.buildResultUpdateResponse).toHaveBeenCalledTimes(1);
    expect(built.updateResultXml).toHaveBeenCalledTimes(1);

    expect(built.applyQtiResultsUpdate).toHaveBeenCalledWith({
      resultsPath: input.resultPath,
      assessmentTestPath: input.assessmentTestPath,
      scoringPath: input.scoringPath,
      preserveMet: input.preserveMet,
    });
    expect(built.readAssessmentTestXml).toHaveBeenCalledWith(input.assessmentTestPath);
    expect(built.updateResultXml).toHaveBeenCalledWith(
      built.dependencies.workspaceDir,
      input.fileName,
      '<updated/>'
    );

    // The validator and the persister must receive the same updatedXml string,
    // byte-for-byte. This is the strongest end-to-end guarantee the route
    // hands the API caller.
    expect(built.buildResultUpdateResponse).toHaveBeenCalledWith(
      expect.objectContaining({ updatedXml: '<updated/>' })
    );
  });

  it('validate-response failure: stops before persist and rejects with the validator error', async () => {
    const built = buildHappyDependencies({
      success: true,
      items: [],
      testScore: null,
    });
    const validatorError = new Error('validation blew up');
    built.buildResultUpdateResponse.mockImplementation(() => {
      throw validatorError;
    });

    await expect(executeResultUpdate(buildInput(), built.dependencies)).rejects.toBe(validatorError);

    expect(built.applyQtiResultsUpdate).toHaveBeenCalledTimes(1);
    expect(built.readAssessmentTestXml).toHaveBeenCalledTimes(1);
    expect(built.parseAssessmentTestXml).toHaveBeenCalledTimes(1);
    expect(built.buildResultUpdateResponse).toHaveBeenCalledTimes(1);
    expect(built.updateResultXml).not.toHaveBeenCalled();
  });

  it('parse-assessment failure: stops before validate and persist, rejects with the parse error', async () => {
    const built = buildHappyDependencies({
      success: true,
      items: [],
      testScore: null,
    });
    const parseError = new Error('bad xml');
    built.parseAssessmentTestXml.mockImplementation(() => {
      throw parseError;
    });

    await expect(executeResultUpdate(buildInput(), built.dependencies)).rejects.toBe(parseError);

    expect(built.applyQtiResultsUpdate).toHaveBeenCalledTimes(1);
    expect(built.readAssessmentTestXml).toHaveBeenCalledTimes(1);
    expect(built.parseAssessmentTestXml).toHaveBeenCalledTimes(1);
    expect(built.buildResultUpdateResponse).not.toHaveBeenCalled();
    expect(built.updateResultXml).not.toHaveBeenCalled();
  });

  it('apply failure: no further step runs, rejects with the apply error', async () => {
    const built = buildHappyDependencies({
      success: true,
      items: [],
      testScore: null,
    });
    const applyError = new Error('apply died');
    built.applyQtiResultsUpdate.mockRejectedValue(applyError);

    await expect(executeResultUpdate(buildInput(), built.dependencies)).rejects.toBe(applyError);

    expect(built.applyQtiResultsUpdate).toHaveBeenCalledTimes(1);
    expect(built.readAssessmentTestXml).not.toHaveBeenCalled();
    expect(built.parseAssessmentTestXml).not.toHaveBeenCalled();
    expect(built.buildResultUpdateResponse).not.toHaveBeenCalled();
    expect(built.updateResultXml).not.toHaveBeenCalled();
  });

  it('persist failure: all five steps ran, rejects with the persist error, no return value', async () => {
    const built = buildHappyDependencies({
      success: true,
      items: [{ identifier: 'item-1', rubricOutcomes: {}, score: null, comment: null }],
      testScore: null,
    });
    const persistError = new Error('write failed');
    built.updateResultXml.mockRejectedValue(persistError);

    await expect(executeResultUpdate(buildInput(), built.dependencies)).rejects.toBe(persistError);

    expect(built.applyQtiResultsUpdate).toHaveBeenCalledTimes(1);
    expect(built.readAssessmentTestXml).toHaveBeenCalledTimes(1);
    expect(built.parseAssessmentTestXml).toHaveBeenCalledTimes(1);
    expect(built.buildResultUpdateResponse).toHaveBeenCalledTimes(1);
    expect(built.updateResultXml).toHaveBeenCalledTimes(1);
  });

  it('read-assessment failure: apply ran, read attempted, the rest not called, rejects with the read error', async () => {
    const built = buildHappyDependencies({
      success: true,
      items: [],
      testScore: null,
    });
    const readError = new Error('cannot read');
    built.readAssessmentTestXml.mockRejectedValue(readError);

    await expect(executeResultUpdate(buildInput(), built.dependencies)).rejects.toBe(readError);

    expect(built.applyQtiResultsUpdate).toHaveBeenCalledTimes(1);
    expect(built.readAssessmentTestXml).toHaveBeenCalledTimes(1);
    expect(built.parseAssessmentTestXml).not.toHaveBeenCalled();
    expect(built.buildResultUpdateResponse).not.toHaveBeenCalled();
    expect(built.updateResultXml).not.toHaveBeenCalled();
  });
});
