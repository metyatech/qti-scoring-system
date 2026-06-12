import { describe, expect, it } from 'vitest';
import { buildResultUpdateResponse } from '@/app/api/workspaces/[id]/results/response';

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

describe('buildResultUpdateResponse', () => {
  it('parses the saved XML and returns items + testScore for the requested identifiers', () => {
    const savedXml = wrapResult(
      `
  <itemResult identifier="item-1" sequenceIndex="1" datestamp="2026-01-01T10:10:00+09:00" sessionStatus="final">
    <responseVariable identifier="RESPONSE" cardinality="single" base-type="string">
      <candidateResponse><value>Test</value></candidateResponse>
    </responseVariable>
    <outcomeVariable identifier="SCORE" baseType="float"><value>2</value></outcomeVariable>
    <outcomeVariable identifier="RUBRIC_1_MET" baseType="boolean"><value>true</value></outcomeVariable>
    <outcomeVariable identifier="RUBRIC_2_MET" baseType="boolean"><value>false</value></outcomeVariable>
    <outcomeVariable identifier="COMMENT" baseType="string"><value>Note</value></outcomeVariable>
  </itemResult>`,
      '2'
    );

    const response = buildResultUpdateResponse({
      savedXml,
      fileName: 'assessmentResult-1.xml',
      requestedIdentifiers: ['item-1'],
    });

    expect(response.success).toBe(true);
    expect(response.items).toHaveLength(1);
    expect(response.items[0].identifier).toBe('item-1');
    expect(response.items[0].rubricOutcomes).toEqual({ 1: true, 2: false });
    expect(response.items[0].score).toBe(2);
    expect(response.items[0].comment).toBe('Note');
    expect(response.testScore).toBe(2);
  });

  it('reports the SAVED rubric and score for a choice item, not the requested (rejected) values', () => {
    // Simulates a choice item that apply-to-qti-results refused to downgrade
    // because it is auto-scored: the server kept RUBRIC_1_MET=true and
    // SCORE=1 even though the caller requested met=false.
    const savedXml = wrapResult(
      `
  <itemResult identifier="item-1" sequenceIndex="1" datestamp="2026-01-01T10:10:00+09:00" sessionStatus="final">
    <responseVariable identifier="RESPONSE" cardinality="single" base-type="string">
      <candidateResponse><value>A</value></candidateResponse>
    </responseVariable>
    <outcomeVariable identifier="SCORE" baseType="float"><value>1</value></outcomeVariable>
    <outcomeVariable identifier="RUBRIC_1_MET" baseType="boolean"><value>true</value></outcomeVariable>
  </itemResult>`,
      '1'
    );

    const response = buildResultUpdateResponse({
      savedXml,
      fileName: 'assessmentResult-1.xml',
      requestedIdentifiers: ['item-1'],
    });

    expect(response.items[0].rubricOutcomes).toEqual({ 1: true });
    expect(response.items[0].score).toBe(1);
    expect(response.testScore).toBe(1);
  });

  it('reports the SAVED rubric and score for a cloze item that was just upgraded', () => {
    // Caller asked for met=true on a cloze criterion that was previously
    // false; apply-to-qti-results persisted the new value, so the helper
    // sees RUBRIC_1_MET=true and reports it back as true.
    const savedXml = wrapResult(
      `
  <itemResult identifier="item-1" sequenceIndex="1" datestamp="2026-01-01T10:10:00+09:00" sessionStatus="final">
    <responseVariable identifier="RESPONSE" cardinality="single" base-type="string">
      <candidateResponse><value>foo</value></candidateResponse>
    </responseVariable>
    <outcomeVariable identifier="SCORE" baseType="float"><value>1</value></outcomeVariable>
    <outcomeVariable identifier="RUBRIC_1_MET" baseType="boolean"><value>true</value></outcomeVariable>
    <outcomeVariable identifier="RUBRIC_2_MET" baseType="boolean"><value>false</value></outcomeVariable>
  </itemResult>`,
      '1'
    );

    const response = buildResultUpdateResponse({
      savedXml,
      fileName: 'assessmentResult-cloze-1.xml',
      requestedIdentifiers: ['item-1'],
    });

    expect(response.items[0].rubricOutcomes).toEqual({ 1: true, 2: false });
    expect(response.items[0].score).toBe(1);
    expect(response.testScore).toBe(1);
  });

  it('returns the whole-test score (every item) when only one item of a multi-item test is updated', () => {
    // Two-item test: item-1 scores 1, item-2 scores 2. Only item-1 is updated,
    // and testResult/SCORE is absent, so the helper must fall back to summing
    // EVERY itemResult (1 + 2 = 3) rather than just the requested item-1.
    const savedXml = wrapResult(
      `
  <itemResult identifier="item-1" sequenceIndex="1" datestamp="2026-01-01T10:10:00+09:00" sessionStatus="final">
    <responseVariable identifier="RESPONSE" cardinality="single" base-type="string">
      <candidateResponse><value>A</value></candidateResponse>
    </responseVariable>
    <outcomeVariable identifier="SCORE" baseType="float"><value>1</value></outcomeVariable>
  </itemResult>
  <itemResult identifier="item-2" sequenceIndex="2" datestamp="2026-01-01T10:10:00+09:00" sessionStatus="final">
    <responseVariable identifier="RESPONSE" cardinality="single" base-type="string">
      <candidateResponse><value>B</value></candidateResponse>
    </responseVariable>
    <outcomeVariable identifier="SCORE" baseType="float"><value>2</value></outcomeVariable>
  </itemResult>`,
      null
    );

    const response = buildResultUpdateResponse({
      savedXml,
      fileName: 'assessmentResult-multi-1.xml',
      requestedIdentifiers: ['item-1'],
    });

    expect(response.items).toHaveLength(1);
    expect(response.items[0].identifier).toBe('item-1');
    expect(response.items[0].score).toBe(1);
    expect(response.testScore).toBe(3);
  });

  it('prefers the authoritative testResult/SCORE over the item-score sum', () => {
    // The saved testResult/SCORE (7) is the source of truth even if it does not
    // match the per-item sum; the helper must return it verbatim.
    const savedXml = wrapResult(
      `
  <itemResult identifier="item-1" sequenceIndex="1" datestamp="2026-01-01T10:10:00+09:00" sessionStatus="final">
    <responseVariable identifier="RESPONSE" cardinality="single" base-type="string">
      <candidateResponse><value>A</value></candidateResponse>
    </responseVariable>
    <outcomeVariable identifier="SCORE" baseType="float"><value>1</value></outcomeVariable>
  </itemResult>
  <itemResult identifier="item-2" sequenceIndex="2" datestamp="2026-01-01T10:10:00+09:00" sessionStatus="final">
    <responseVariable identifier="RESPONSE" cardinality="single" base-type="string">
      <candidateResponse><value>B</value></candidateResponse>
    </responseVariable>
    <outcomeVariable identifier="SCORE" baseType="float"><value>2</value></outcomeVariable>
  </itemResult>`,
      '7'
    );

    const response = buildResultUpdateResponse({
      savedXml,
      fileName: 'assessmentResult-multi-2.xml',
      requestedIdentifiers: ['item-1'],
    });

    expect(response.items).toHaveLength(1);
    expect(response.testScore).toBe(7);
  });

  it('returns a sparse row when the saved XML has no itemResult for the requested identifier', () => {
    const savedXml = wrapResult(
      `
  <itemResult identifier="item-1" sequenceIndex="1" datestamp="2026-01-01T10:10:00+09:00" sessionStatus="final">
    <responseVariable identifier="RESPONSE" cardinality="single" base-type="string">
      <candidateResponse><value>A</value></candidateResponse>
    </responseVariable>
    <outcomeVariable identifier="SCORE" baseType="float"><value>0</value></outcomeVariable>
  </itemResult>`,
      '0'
    );

    const response = buildResultUpdateResponse({
      savedXml,
      fileName: 'assessmentResult-1.xml',
      requestedIdentifiers: ['item-missing'],
    });

    expect(response.items).toHaveLength(1);
    expect(response.items[0].identifier).toBe('item-missing');
    expect(response.items[0].rubricOutcomes).toEqual({});
    expect(response.items[0].score).toBeNull();
    expect(response.items[0].comment).toBeNull();
    // testScore reflects the whole test (testResult/SCORE = 0), independent of
    // the requested (missing) identifier.
    expect(response.testScore).toBe(0);
  });
});
