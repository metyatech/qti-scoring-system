import { describe, expect, it } from 'vitest';
import {
  extractItemIdentifier,
  extractResultItemIdentifiers,
  validateMappingConsistency,
} from '@/lib/qtiValidation';

describe('extractItemIdentifier', () => {
  it('extracts identifier from assessment item', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item identifier="item-1" title="Test" xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0"></qti-assessment-item>`;
    expect(extractItemIdentifier(xml)).toBe('item-1');
  });
});

describe('extractResultItemIdentifiers', () => {
  it('extracts itemResult identifiers', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentResult xmlns="http://www.imsglobal.org/xsd/imsqti_result_v3p0">
  <itemResult identifier="Q1"></itemResult>
  <itemResult identifier="Q2"></itemResult>
</assessmentResult>`;
    expect(extractResultItemIdentifiers(xml)).toEqual(['Q1', 'Q2']);
  });
});

describe('validateMappingConsistency', () => {
  it('detects missing mapping and unknown ids', () => {
    const items = [
      `<?xml version="1.0" encoding="UTF-8"?><qti-assessment-item identifier="item-1" xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0"></qti-assessment-item>`,
    ];
    const results = [
      `<?xml version="1.0" encoding="UTF-8"?><assessmentResult xmlns="http://www.imsglobal.org/xsd/imsqti_result_v3p0"><itemResult identifier="Q1"></itemResult></assessmentResult>`,
    ];
    const mapping = `resultItemIdentifier,itemIdentifier\nQ2,item-1`;
    const validation = validateMappingConsistency(items, results, mapping);
    expect(validation.isValid).toBe(false);
    expect(validation.errors.join('\n')).toContain('results に存在しない resultItemIdentifier');
    expect(validation.errors.join('\n')).toContain('マッピング未定義の結果ID');
  });

  it('passes valid mapping', () => {
    const items = [
      `<?xml version="1.0" encoding="UTF-8"?><qti-assessment-item identifier="item-1" xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0"></qti-assessment-item>`,
    ];
    const results = [
      `<?xml version="1.0" encoding="UTF-8"?><assessmentResult xmlns="http://www.imsglobal.org/xsd/imsqti_result_v3p0"><itemResult identifier="Q1"></itemResult></assessmentResult>`,
    ];
    const mapping = `resultItemIdentifier,itemIdentifier\nQ1,item-1`;
    const validation = validateMappingConsistency(items, results, mapping);
    expect(validation.isValid).toBe(true);
  });
});
