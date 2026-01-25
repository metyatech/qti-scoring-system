import { describe, expect, it } from 'vitest';
import {
  parseAssessmentTestXml,
  parseQtiItemXml,
  parseQtiResultsXml,
  remapResultToAssessmentItems,
  resolveAssessmentHref,
} from '@/utils/qtiParsing';

describe('assessmentTest mapping helpers', () => {
  it('parses assessmentTest item refs in order', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-test xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="assessment-test" title="Assessment Test">
  <qti-test-part identifier="part-1" navigation-mode="linear" submission-mode="individual">
    <qti-assessment-section identifier="section-1" title="Section 1" visible="true">
      <qti-assessment-item-ref identifier="item-1" href="items/item-1.qti.xml"/>
      <qti-assessment-item-ref identifier="item-2" href="items/item-2.qti.xml"/>
    </qti-assessment-section>
  </qti-test-part>
</qti-assessment-test>`;
    const refs = parseAssessmentTestXml(xml);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual({ identifier: 'item-1', href: 'items/item-1.qti.xml' });
    expect(refs[1]).toEqual({ identifier: 'item-2', href: 'items/item-2.qti.xml' });
  });

  it('resolves href relative to assessmentTest location', () => {
    const resolved = resolveAssessmentHref('qti/assessment-test.qti.xml', 'items/item-1.qti.xml');
    expect(resolved).toBe('qti/items/item-1.qti.xml');
  });

  it('rejects traversal in href', () => {
    expect(() => resolveAssessmentHref('assessment-test.qti.xml', '../item.qti.xml')).toThrow();
  });

  it('remaps by sequenceIndex, identifier, and Q-number fallback', () => {
    const itemRefs = [
      { identifier: 'item-1', href: 'item-1.qti.xml' },
      { identifier: 'item-2', href: 'item-2.qti.xml' },
    ];
    const result = parseQtiResultsXml(
      `<?xml version="1.0" encoding="UTF-8"?>
<assessmentResult xmlns="http://www.imsglobal.org/xsd/imsqti_result_v3p0">
  <context sourcedId="candidate-1" />
  <itemResult identifier="Q1" sequenceIndex="1" datestamp="2026-01-01T10:10:00+09:00" sessionStatus="final">
    <responseVariable identifier="RESPONSE" cardinality="single" baseType="string">
      <candidateResponse><value>a</value></candidateResponse>
    </responseVariable>
  </itemResult>
  <itemResult identifier="item-2" sequenceIndex="2" datestamp="2026-01-01T10:10:00+09:00" sessionStatus="final">
    <responseVariable identifier="RESPONSE" cardinality="single" baseType="string">
      <candidateResponse><value>b</value></candidateResponse>
    </responseVariable>
  </itemResult>
</assessmentResult>`,
      'results.xml'
    );
    const remapped = remapResultToAssessmentItems(result, itemRefs);
    expect(remapped.missingResultIdentifiers).toHaveLength(0);
    expect(remapped.duplicateItemIdentifiers).toHaveLength(0);
    expect(Object.keys(remapped.mappedItemResults)).toEqual(['item-1', 'item-2']);
  });

  it('reports missing identifiers when mapping fails', () => {
    const itemRefs = [{ identifier: 'item-1', href: 'item-1.qti.xml' }];
    const result = parseQtiResultsXml(
      `<?xml version="1.0" encoding="UTF-8"?>
<assessmentResult xmlns="http://www.imsglobal.org/xsd/imsqti_result_v3p0">
  <context sourcedId="candidate-1" />
  <itemResult identifier="X1" datestamp="2026-01-01T10:10:00+09:00" sessionStatus="final">
    <responseVariable identifier="RESPONSE" cardinality="single" baseType="string">
      <candidateResponse><value>a</value></candidateResponse>
    </responseVariable>
  </itemResult>
</assessmentResult>`,
      'results.xml'
    );
    const remapped = remapResultToAssessmentItems(result, itemRefs);
    expect(remapped.missingResultIdentifiers).toEqual(['X1']);
  });

  it('uses Q-number fallback when sequenceIndex is absent', () => {
    const itemRefs = [
      { identifier: 'item-1', href: 'item-1.qti.xml' },
      { identifier: 'item-2', href: 'item-2.qti.xml' },
    ];
    const result = parseQtiResultsXml(
      `<?xml version="1.0" encoding="UTF-8"?>
<assessmentResult xmlns="http://www.imsglobal.org/xsd/imsqti_result_v3p0">
  <context sourcedId="candidate-1" />
  <itemResult identifier="Q2" datestamp="2026-01-01T10:10:00+09:00" sessionStatus="final" />
</assessmentResult>`,
      'results.xml'
    );
    const remapped = remapResultToAssessmentItems(result, itemRefs);
    expect(remapped.missingResultIdentifiers).toHaveLength(0);
    expect(Object.keys(remapped.mappedItemResults)).toEqual(['item-2']);
  });

  it('detects duplicate mapping targets', () => {
    const itemRefs = [{ identifier: 'item-1', href: 'item-1.qti.xml' }];
    const result = parseQtiResultsXml(
      `<?xml version="1.0" encoding="UTF-8"?>
<assessmentResult xmlns="http://www.imsglobal.org/xsd/imsqti_result_v3p0">
  <context sourcedId="candidate-1" />
  <itemResult identifier="Q1" sequenceIndex="1" datestamp="2026-01-01T10:10:00+09:00" sessionStatus="final" />
  <itemResult identifier="item-1" sequenceIndex="1" datestamp="2026-01-01T10:10:00+09:00" sessionStatus="final" />
</assessmentResult>`,
      'results.xml'
    );
    const remapped = remapResultToAssessmentItems(result, itemRefs);
    expect(remapped.duplicateItemIdentifiers).toContain('item-1');
  });
});

describe('parseQtiItemXml', () => {
  it('parses choice item with rubric', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="item-1" title="Prime Number" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
    <qti-correct-response>
      <qti-value>CHOICE_2</qti-value>
    </qti-correct-response>
  </qti-response-declaration>
  <qti-item-body>
    <qti-p>Which number is prime?</qti-p>
    <qti-choice-interaction response-identifier="RESPONSE" max-choices="1">
      <qti-simple-choice identifier="CHOICE_1">9</qti-simple-choice>
      <qti-simple-choice identifier="CHOICE_2">11</qti-simple-choice>
    </qti-choice-interaction>
    <qti-rubric-block view="scorer">
      <qti-p>[2] Selects the only prime number</qti-p>
    </qti-rubric-block>
  </qti-item-body>
</qti-assessment-item>`;
    const item = parseQtiItemXml(xml);
    expect(item.identifier).toBe('item-1');
    expect(item.title).toBe('Prime Number');
    expect(item.type).toBe('choice');
    expect(item.choices).toHaveLength(2);
    expect(item.rubric).toHaveLength(1);
    expect(item.promptHtml).toContain('qti-choice-list');
  });

  it('falls back to identifier when title is missing', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="item-2" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
  <qti-item-body>
    <qti-p>Describe gravity.</qti-p>
    <qti-extended-text-interaction response-identifier="RESPONSE"/>
  </qti-item-body>
</qti-assessment-item>`;
    const item = parseQtiItemXml(xml);
    expect(item.title).toBe('item-2');
    expect(item.type).toBe('descriptive');
  });

  it('detects cloze item type', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="item-3" title="Cloze" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
  <qti-item-body>
    <qti-p>Water is <qti-text-entry-interaction response-identifier="RESPONSE"/>.</qti-p>
  </qti-item-body>
</qti-assessment-item>`;
    const item = parseQtiItemXml(xml);
    expect(item.type).toBe('cloze');
    expect(item.promptHtml).toContain('qti-blank');
  });
});

describe('parseQtiResultsXml', () => {
  it('parses responses, rubric outcomes, and comments', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentResult xmlns="http://www.imsglobal.org/xsd/imsqti_result_v3p0">
  <context sourcedId="sample.user@example.com">
    <sessionIdentifier sourceID="candidateName" identifier="Sample User" />
  </context>
  <itemResult identifier="Q1" sequenceIndex="1" datestamp="2026-01-01T10:10:00+09:00" sessionStatus="final">
    <responseVariable identifier="RESPONSE" cardinality="single" baseType="string">
      <candidateResponse>
        <value>answer</value>
      </candidateResponse>
    </responseVariable>
    <outcomeVariable identifier="SCORE" baseType="float">
      <value>1</value>
    </outcomeVariable>
    <outcomeVariable identifier="COMMENT" baseType="string">
      <value>Good</value>
    </outcomeVariable>
    <outcomeVariable identifier="RUBRIC_1_MET" baseType="boolean">
      <value>true</value>
    </outcomeVariable>
    <outcomeVariable identifier="RUBRIC_2_MET" baseType="boolean">
      <value>false</value>
    </outcomeVariable>
  </itemResult>
</assessmentResult>`;
    const result = parseQtiResultsXml(xml, 'results.xml');
    expect(result.candidateName).toBe('Sample User');
    const itemResult = result.itemResults['Q1'];
    expect(itemResult.sequenceIndex).toBe(1);
    expect(itemResult.response).toBe('answer');
    expect(itemResult.score).toBe(1);
    expect(itemResult.comment).toBe('Good');
    expect(itemResult.rubricOutcomes[1]).toBe(true);
    expect(itemResult.rubricOutcomes[2]).toBe(false);
  });

  it('parses ordered responses as array', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentResult xmlns="http://www.imsglobal.org/xsd/imsqti_result_v3p0">
  <context sourcedId="candidate-1"></context>
  <itemResult identifier="Q2" sequenceIndex="2" datestamp="2026-01-01T10:10:00+09:00" sessionStatus="final">
    <responseVariable identifier="RESPONSE" cardinality="ordered" baseType="string">
      <candidateResponse>
        <value>H2O</value>
        <value>water</value>
      </candidateResponse>
    </responseVariable>
  </itemResult>
</assessmentResult>`;
    const result = parseQtiResultsXml(xml, 'results.xml');
    const itemResult = result.itemResults['Q2'];
    expect(itemResult.response).toEqual(['H2O', 'water']);
  });

  it('drops invalid sequenceIndex values', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentResult xmlns="http://www.imsglobal.org/xsd/imsqti_result_v3p0">
  <context sourcedId="candidate-1"></context>
  <itemResult identifier="Q1" sequenceIndex="0" datestamp="2026-01-01T10:10:00+09:00" sessionStatus="final" />
  <itemResult identifier="Q2" sequenceIndex="x" datestamp="2026-01-01T10:10:00+09:00" sessionStatus="final" />
</assessmentResult>`;
    const result = parseQtiResultsXml(xml, 'results.xml');
    expect(result.itemResults['Q1'].sequenceIndex).toBeUndefined();
    expect(result.itemResults['Q2'].sequenceIndex).toBeUndefined();
  });
});
