import { describe, expect, it } from 'vitest';
import { normalizeUploadPath } from '@/utils/uploadName';

describe('normalizeUploadPath', () => {
  it('decodes percent-encoded filenames', () => {
    const input = 'JavaScript%E2%85%A1_%E6%9C%9F%E6%9C%AB%2Fitem.qti.xml';
    expect(normalizeUploadPath(input)).toBe('JavaScriptⅡ_期末/item.qti.xml');
  });

  it('normalizes slashes and trims leading separators', () => {
    expect(normalizeUploadPath('\\items\\Q1.qti.xml')).toBe('items/Q1.qti.xml');
    expect(normalizeUploadPath('/items/Q1.qti.xml')).toBe('items/Q1.qti.xml');
  });

  it('keeps invalid percent-encoding as-is', () => {
    expect(normalizeUploadPath('bad%zz.qti.xml')).toBe('bad%zz.qti.xml');
  });
});
