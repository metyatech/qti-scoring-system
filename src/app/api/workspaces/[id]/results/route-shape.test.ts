import { describe, expect, it } from 'vitest';
import { buildResultUpdateResponse } from '@/app/api/workspaces/[id]/results/response';
import type { AssessmentItemRef } from 'qti-xml-core';

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

// Build a minimal AssessmentItemRef array from a list of identifiers. The
// href is irrelevant to the helper — only identifier order (and therefore
// sequenceIndex mapping) matters.
const refs = (...identifiers: string[]): AssessmentItemRef[] =>
  identifiers.map((identifier) => ({ identifier, href: `${identifier}.xml` }));

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
      assessmentTestRefs: refs('item-1'),
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
      assessmentTestRefs: refs('item-1'),
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
      assessmentTestRefs: refs('item-1'),
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
      assessmentTestRefs: refs('item-1', 'item-2'),
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
      assessmentTestRefs: refs('item-1', 'item-2'),
    });

    expect(response.items).toHaveLength(1);
    expect(response.testScore).toBe(7);
  });

  it('remaps when the Results itemResult identifier differs from the assessment item identifier', () => {
    // Assessment item is "question-source-id" (assessment-test order = 1),
    // but the Results XML uses the legacy "Q1" identifier with
    // sequenceIndex=1. The helper must resolve Q1 -> question-source-id
    // via the Q<n> remap and match the request accordingly.
    const savedXml = wrapResult(
      `
  <itemResult identifier="Q1" sequenceIndex="1" datestamp="2026-01-01T10:10:00+09:00" sessionStatus="final">
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
      fileName: 'assessmentResult-remap-1.xml',
      requestedIdentifiers: ['question-source-id'],
      assessmentTestRefs: refs('question-source-id'),
    });

    expect(response.items).toHaveLength(1);
    expect(response.items[0].identifier).toBe('question-source-id');
    expect(response.items[0].rubricOutcomes).toEqual({ 1: true });
    expect(response.items[0].score).toBe(1);
    expect(response.testScore).toBe(1);
  });

  it('throws when the saved XML has no itemResult for the requested assessment item', () => {
    // The assessment item "item-2" exists in the test, but the saved XML
    // has no itemResult that maps to it. Returning a sparse row would
    // erase the caller's just-saved UI state, so the helper throws.
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

    expect(() =>
      buildResultUpdateResponse({
        savedXml,
        fileName: 'assessmentResult-1.xml',
        requestedIdentifiers: ['item-2'],
        assessmentTestRefs: refs('item-1', 'item-2'),
      })
    ).toThrow(/requested identifier "item-2" was not saved in the Results XML/);
  });

  it('throws when the requested identifier is not an item in the assessment-test', () => {
    // The saved XML is well-formed, but the caller asked for "item-ghost",
    // which is not in the assessment-test at all.
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

    expect(() =>
      buildResultUpdateResponse({
        savedXml,
        fileName: 'assessmentResult-1.xml',
        requestedIdentifiers: ['item-ghost'],
        assessmentTestRefs: refs('item-1'),
      })
    ).toThrow(/requested identifier "item-ghost" is not an item in the assessment-test XML/);
  });

  it('throws when an itemResult cannot be matched to any assessment item', () => {
    // The Results XML has an itemResult with sequenceIndex=99, which is
    // out of range for the two-item assessment-test. There is no
    // identifier match either. The remap helper flags this and the
    // route-layer helper surfaces it.
    const savedXml = wrapResult(
      `
  <itemResult identifier="orphan-1" sequenceIndex="99" datestamp="2026-01-01T10:10:00+09:00" sessionStatus="final">
    <responseVariable identifier="RESPONSE" cardinality="single" base-type="string">
      <candidateResponse><value>A</value></candidateResponse>
    </responseVariable>
    <outcomeVariable identifier="SCORE" baseType="float"><value>0</value></outcomeVariable>
  </itemResult>`,
      '0'
    );

    expect(() =>
      buildResultUpdateResponse({
        savedXml,
        fileName: 'assessmentResult-orphan.xml',
        requestedIdentifiers: ['item-1'],
        assessmentTestRefs: refs('item-1', 'item-2'),
      })
    ).toThrow(/could not be matched to any assessment item/);
  });

  it('throws when multiple itemResults map to the same assessment item', () => {
    // Two distinct itemResults (different identifiers, different
    // sequenceIndexes) both resolve to the same assessment item via the
    // remap rules: "Q1" matches by Q<n> pattern, "item-1" matches by
    // direct identifier, and there is only one assessment item in the
    // test. The remap helper flags this as a duplicate mapping.
    const savedXml = wrapResult(
      `
  <itemResult identifier="Q1" sequenceIndex="1" datestamp="2026-01-01T10:10:00+09:00" sessionStatus="final">
    <responseVariable identifier="RESPONSE" cardinality="single" base-type="string">
      <candidateResponse><value>A</value></candidateResponse>
    </responseVariable>
    <outcomeVariable identifier="SCORE" baseType="float"><value>1</value></outcomeVariable>
  </itemResult>
  <itemResult identifier="item-1" sequenceIndex="1" datestamp="2026-01-01T10:10:00+09:00" sessionStatus="final">
    <responseVariable identifier="RESPONSE" cardinality="single" base-type="string">
      <candidateResponse><value>B</value></candidateResponse>
    </responseVariable>
    <outcomeVariable identifier="SCORE" baseType="float"><value>2</value></outcomeVariable>
  </itemResult>`,
      '0'
    );

    expect(() =>
      buildResultUpdateResponse({
        savedXml,
        fileName: 'assessmentResult-dup.xml',
        requestedIdentifiers: ['item-1'],
        assessmentTestRefs: refs('item-1'),
      })
    ).toThrow(/multiple itemResults mapped to the same assessment item/);
  });
});
