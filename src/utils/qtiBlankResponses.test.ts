import { describe, expect, it } from 'vitest';
import { applyResponsesToPromptHtml } from '@/utils/qtiBlankResponses';

describe('applyResponsesToPromptHtml', () => {
  it('fills cloze blanks with ordered responses', () => {
    const promptHtml =
      '<p>A<input class="qti-blank-input" data-blank="1" type="text" size="6" disabled aria-label="blank 1" />B<input class="qti-blank-input" data-blank="2" type="text" size="6" disabled aria-label="blank 2" />C</p>';

    const resultHtml = applyResponsesToPromptHtml(promptHtml, ['foo', 'longerAnswer']);
    const doc = new DOMParser().parseFromString(resultHtml, 'text/html');
    const blanks = doc.querySelectorAll<HTMLInputElement>('input.qti-blank-input');

    expect(blanks).toHaveLength(2);
    expect(blanks[0].getAttribute('value')).toBe('foo');
    expect(blanks[0].getAttribute('size')).toBe('6');
    expect(blanks[1].getAttribute('value')).toBe('longerAnswer');
    expect(blanks[1].getAttribute('size')).toBe(String('longerAnswer'.length));
  });

  it('fills the first blank when the response is a single string', () => {
    const promptHtml =
      '<p>Hello <input class="qti-blank-input" data-blank="1" type="text" size="6" disabled aria-label="blank 1" /> world.</p>';

    const resultHtml = applyResponsesToPromptHtml(promptHtml, 'TypeScript');
    const doc = new DOMParser().parseFromString(resultHtml, 'text/html');
    const blank = doc.querySelector<HTMLInputElement>('input.qti-blank-input');

    expect(blank?.getAttribute('value')).toBe('TypeScript');
    expect(blank?.getAttribute('size')).toBe(String('TypeScript'.length));
  });

  it('leaves blanks empty when there is no response', () => {
    const promptHtml =
      '<p>A<input class="qti-blank-input" data-blank="1" type="text" size="6" disabled aria-label="blank 1" />B</p>';

    const resultHtml = applyResponsesToPromptHtml(promptHtml, null);
    const doc = new DOMParser().parseFromString(resultHtml, 'text/html');
    const blank = doc.querySelector<HTMLInputElement>('input.qti-blank-input');

    expect(blank?.hasAttribute('value')).toBe(false);
    expect(blank?.getAttribute('size')).toBe('6');
  });
});

