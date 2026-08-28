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
    <p>Which number is prime?</p>
    <qti-choice-interaction response-identifier="RESPONSE" max-choices="1">
      <qti-simple-choice identifier="CHOICE_1">9</qti-simple-choice>
      <qti-simple-choice identifier="CHOICE_2">11</qti-simple-choice>
    </qti-choice-interaction>
    <qti-rubric-block view="scorer">
      <p>[2] Selects the only prime number</p>
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
    <p>Describe gravity.</p>
    <qti-extended-text-interaction response-identifier="RESPONSE"/>
  </qti-item-body>
</qti-assessment-item>`;
    const item = parseQtiItemXml(xml);
    expect(item.title).toBe('item-2');
    expect(item.type).toBe('descriptive');
  });

  it('classifies extended-text interaction as descriptive', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="item-extended" title="Extended" adaptive="false" time-dependent="false">
  <qti-item-body>
    <qti-extended-text-interaction response-identifier="RESPONSE" />
  </qti-item-body>
</qti-assessment-item>`;
    expect(parseQtiItemXml(xml).type).toBe('descriptive');
  });

  it('does not classify descriptive HTML containing qti-blank-input as cloze', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="item-text" title="Text" adaptive="false" time-dependent="false">
  <qti-item-body>
    <p>The literal text qti-blank-input is part of the answer guidance.</p>
    <qti-extended-text-interaction response-identifier="RESPONSE" />
  </qti-item-body>
</qti-assessment-item>`;
    const item = parseQtiItemXml(xml);
    expect(item.type).toBe('descriptive');
    expect(item.promptHtml).toContain('qti-blank-input');
  });

  it('detects cloze item type', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="item-3" title="Cloze" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
  <qti-item-body>
    <p>Water is <qti-text-entry-interaction response-identifier="RESPONSE"/>.</p>
  </qti-item-body>
</qti-assessment-item>`;
    const item = parseQtiItemXml(xml);
    expect(item.type).toBe('cloze');
    expect(item.promptHtml).toContain('qti-blank-input');
    expect(item.promptHtml).toContain('<input');
    expect(item.promptHtml).not.toContain('<br');
    expect(item.promptHtml).toContain('size="6"');
  });

  it('does not introduce line breaks around blanks inside canonical pre/code', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="item-pre" title="Pre" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
  <qti-item-body>
    <pre><code>opacity:
      <qti-text-entry-interaction response-identifier="RESPONSE"/>
      ;</code></pre>
  </qti-item-body>
</qti-assessment-item>`;
    const item = parseQtiItemXml(xml);
    expect(item.promptHtml).toContain('<pre class="qti-pre-with-blanks">');
    expect(item.promptHtml).not.toMatch(/<\/code>\s*[\r\n]+\s*<input/);
    expect(item.promptHtml).not.toMatch(/<input[^>]*>\s*[\r\n]+\s*<code/);
    const prompt = new DOMParser().parseFromString(item.promptHtml, 'text/html');
    const code = prompt.querySelector('pre > code');
    expect(code?.textContent).toContain('opacity:');
    expect(code?.querySelector('input.qti-blank-input')).not.toBeNull();
  });

  it('preserves required newlines around standalone blanks in canonical pre/code', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="item-pre-newline" title="Pre Newline" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
  <qti-item-body>
    <pre><code>}

</code><qti-text-entry-interaction response-identifier="RESPONSE"/><code>
{
}</code></pre>
  </qti-item-body>
</qti-assessment-item>`;
    const item = parseQtiItemXml(xml);
    const doc = new DOMParser().parseFromString(item.promptHtml, 'text/html');
    const blank = doc.querySelector('input.qti-blank-input');
    expect(blank).not.toBeNull();
    const prevCode = blank?.previousElementSibling as HTMLElement | null;
    const nextCode = blank?.nextElementSibling as HTMLElement | null;
    expect(prevCode?.tagName).toBe('CODE');
    expect(nextCode?.tagName).toBe('CODE');
    expect((prevCode?.textContent ?? '').endsWith('\n')).toBe(true);
    expect((nextCode?.textContent ?? '').startsWith('\n')).toBe(true);
  });

  it('parses explanation from modal feedback', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="item-expl" title="With Explanation" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
  <qti-outcome-declaration identifier="FEEDBACK" cardinality="single" base-type="identifier"/>
  <qti-response-processing>
    <qti-set-outcome-value identifier="FEEDBACK">
      <qti-base-value base-type="identifier">EXPLANATION</qti-base-value>
    </qti-set-outcome-value>
  </qti-response-processing>
  <qti-item-body>
    <p>Explain the answer.</p>
    <qti-extended-text-interaction response-identifier="RESPONSE"/>
  </qti-item-body>
  <qti-modal-feedback outcome-identifier="FEEDBACK" identifier="EXPLANATION" show-hide="show">
    <qti-content-body>
      <p>This is the explanation.</p>
      <ul>
        <li>Point A</li>
      </ul>
    </qti-content-body>
  </qti-modal-feedback>
</qti-assessment-item>`;
    const item = parseQtiItemXml(xml);
    expect(item.candidateExplanationHtml).not.toBeNull();
    const explanationHtml = item.candidateExplanationHtml ?? '';
    expect(explanationHtml).toContain('<p>This is the explanation.</p>');
    expect(explanationHtml).toContain('<li>Point A</li>');
    expect(item.promptHtml).not.toContain('This is the explanation.');
  });

  it('does not parse explanation from candidate rubric block', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="item-rubric-expl" title="Candidate Rubric" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
  <qti-item-body>
    <p>Prompt</p>
    <qti-rubric-block view="candidate">
      <p>Legacy explanation</p>
    </qti-rubric-block>
  </qti-item-body>
</qti-assessment-item>`;
    const item = parseQtiItemXml(xml);
    expect(item.candidateExplanationHtml).toBeNull();
    expect(item.promptHtml).not.toContain('Legacy explanation');
  });

  it('renders all mapped QTI flow elements', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="item-flow" title="Flow" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
  <qti-item-body>
    <h3>Heading 3</h3>
    <h4>Heading 4</h4>
    <h5>Heading 5</h5>
    <h6>Heading 6</h6>
    <p>
      Text <em>em</em> <strong>strong</strong> <del>del</del>
      <a href="https://example.com" title="Example">link</a>
      <code>inline()</code>
    </p>
    <pre><code>const x = 1;</code></pre>
    <blockquote><p>Quote</p></blockquote>
    <ul>
      <li>[ ] Task</li>
      <li>Item</li>
    </ul>
    <ol start="3">
      <li>Third</li>
    </ol>
    <table>
      <thead>
        <tr><th>H</th></tr>
      </thead>
      <tbody>
        <tr><td>D</td></tr>
      </tbody>
    </table>
    <hr />
    <p><img src="img.png" alt="alt" title="title" /></p>
  </qti-item-body>
</qti-assessment-item>`;
    const item = parseQtiItemXml(xml);
    expect(item.type).toBe('descriptive');
    expect(item.promptHtml).toContain('<h3>Heading 3</h3>');
    expect(item.promptHtml).toContain('<h4>Heading 4</h4>');
    expect(item.promptHtml).toContain('<h5>Heading 5</h5>');
    expect(item.promptHtml).toContain('<h6>Heading 6</h6>');
    expect(item.promptHtml).toContain('<em>em</em>');
    expect(item.promptHtml).toContain('<strong>strong</strong>');
    expect(item.promptHtml).toContain('<del>del</del>');
    expect(item.promptHtml).toContain('<a href="https://example.com" title="Example">link</a>');
    expect(item.promptHtml).toContain('<code>inline()</code>');
    expect(item.promptHtml).toContain('<pre><code>const x = 1;</code></pre>');
    expect(item.promptHtml).toContain('<blockquote><p>Quote</p></blockquote>');
    expect(item.promptHtml).toContain('<ul>');
    expect(item.promptHtml).toContain('<li>[ ] Task</li>');
    expect(item.promptHtml).toContain('<ol start="3">');
    expect(item.promptHtml).toContain('<table>');
    expect(item.promptHtml).toContain('<thead>');
    expect(item.promptHtml).toContain('<tbody>');
    expect(item.promptHtml).toContain('<th>H</th>');
    expect(item.promptHtml).toContain('<td>D</td>');
    expect(item.promptHtml).toContain('<hr />');
    expect(item.promptHtml).toContain('<img src="img.png" alt="alt" title="title" />');
  });

  it('preserves styled blank-like spans and bare flow elements', () => {
    const item = parseQtiItemXml(`
      <qti-assessment-item identifier="item-canonical" title="Canonical">
        <qti-item-body>
          <p>before <span style="display:inline-block;min-width:4em;border:1px solid #000;text-align:center;background:transparent;" class="answer" data-slot="a" aria-label="answer">A</span> after</p>
          <img src="image.png" alt="Image" /><br /><hr />
        </qti-item-body>
      </qti-assessment-item>`);
    const prompt = new DOMParser().parseFromString(item.promptHtml, 'text/html');
    const span = prompt.querySelector('span.answer');
    expect(span?.getAttribute('style')).toContain('min-width:4em');
    expect(span?.getAttribute('data-slot')).toBe('a');
    expect(span?.getAttribute('aria-label')).toBe('answer');
    expect(prompt.querySelector('img[src="image.png"]')).not.toBeNull();
    expect(prompt.querySelector('br')).not.toBeNull();
    expect(prompt.querySelector('hr')).not.toBeNull();
  });

  it('preserves rich code structure around styled content', () => {
    const item = parseQtiItemXml(`
      <qti-assessment-item identifier="item-rich-code" title="Rich code">
        <qti-item-body><pre><code>foo <span style="display:inline-block;min-width:4em;border:1px solid #000;text-align:center;background:transparent;">A</span> bar</code></pre></qti-item-body>
      </qti-assessment-item>`);
    const code = new DOMParser().parseFromString(item.promptHtml, 'text/html').querySelector('pre > code');
    expect(code?.textContent).toBe('foo A bar');
    expect(code?.querySelector('span')).not.toBeNull();
  });

  it('keeps code cloze interaction position and metadata', () => {
    const item = parseQtiItemXml(`
      <qti-assessment-item identifier="item-code-cloze" title="Code cloze">
        <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string" />
        <qti-item-body><pre><code>foo <qti-text-entry-interaction response-identifier="RESPONSE" /> bar</code></pre></qti-item-body>
      </qti-assessment-item>`);
    expect(item.type).toBe('cloze');
    const code = new DOMParser().parseFromString(item.promptHtml, 'text/html').querySelector('pre > code');
    const blank = code?.querySelector('input.qti-blank-input');
    expect(code?.textContent).toMatch(/^foo\s+\s+bar$/);
    expect(blank?.getAttribute('data-interaction-id')).toBe('RESPONSE');
    expect(blank?.getAttribute('data-blank')).toBe('1');
  });

  it('preserves rich choices and modal feedback explanation', () => {
    const item = parseQtiItemXml(`
      <qti-assessment-item identifier="item-rich-choice" title="Rich choice">
        <qti-item-body>
          <qti-choice-interaction response-identifier="RESPONSE" max-choices="1">
            <qti-simple-choice identifier="A">Choice <strong>one</strong></qti-simple-choice>
          </qti-choice-interaction>
        </qti-item-body>
        <qti-modal-feedback outcome-identifier="FEEDBACK" identifier="EXPLANATION" show-hide="show">
          <qti-content-body><p>Explanation <em>with detail</em>.</p></qti-content-body>
        </qti-modal-feedback>
      </qti-assessment-item>`);
    expect(item.choices[0]?.text).toBe('Choice one');
    expect(item.promptHtml).toContain('Choice <strong>one</strong>');
    expect(item.candidateExplanationHtml).toContain('<em>with detail</em>');
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
