import { afterEach, describe, expect, it, vi } from 'vitest';
import { autoResizeTextarea } from '@/utils/textarea';

describe('autoResizeTextarea', () => {
  const createTextarea = (): HTMLTextAreaElement => {
    const el = document.createElement('textarea');
    document.body.appendChild(el);
    return el;
  };

  const stubComputedStyle = (el: HTMLTextAreaElement, values: Partial<CSSStyleDeclaration>) => {
    const original = window.getComputedStyle;
    const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((node) => {
      if (node === el) {
        return { ...original(node), ...values } as CSSStyleDeclaration;
      }
      return original(node);
    });
    return spy;
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not throw when element is null', () => {
    expect(() => autoResizeTextarea(null)).not.toThrow();
  });

  it('sets height to scrollHeight for content-box textareas', () => {
    const el = createTextarea();
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 120 });
    stubComputedStyle(el, { boxSizing: 'content-box' });

    autoResizeTextarea(el);

    expect(el.style.height).toBe('120px');
  });

  it('resets height to "auto" before measuring so shrinking content shrinks the box', () => {
    const el = createTextarea();
    el.style.height = '300px';
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 80 });
    stubComputedStyle(el, { boxSizing: 'content-box' });

    autoResizeTextarea(el);

    expect(el.style.height).toBe('80px');
  });

  it('writes the new height on every call (resets to "auto" first, then remeasures)', () => {
    const el = createTextarea();
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 100 });
    stubComputedStyle(el, { boxSizing: 'content-box' });

    // First call writes the resolved height.
    autoResizeTextarea(el);
    expect(el.style.height).toBe('100px');

    // Calling again still writes the same pixel value: the implementation
    // always resets to "auto" before measuring, so the post-reset comparison
    // is "auto" !== "100px" and the pixel value is rewritten. The
    // pixel-rewrite happens unconditionally — that is by design, so the
    // box is always sized to the latest content even if `scrollHeight`
    // happened to match a previous render.
    const setter = vi.spyOn(el.style, 'height', 'set');
    autoResizeTextarea(el);

    const written = setter.mock.calls.map(([value]) => value);
    expect(written).toEqual(['auto', '100px']);
  });

  it('adds borderTopWidth + borderBottomWidth for border-box textareas', () => {
    const el = createTextarea();
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 100 });
    stubComputedStyle(el, {
      boxSizing: 'border-box',
      borderTopWidth: '1px',
      borderBottomWidth: '1px',
    });

    autoResizeTextarea(el);

    expect(el.style.height).toBe('102px');
  });

  it('handles fractional border widths in border-box mode', () => {
    const el = createTextarea();
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 50 });
    stubComputedStyle(el, {
      boxSizing: 'border-box',
      borderTopWidth: '0.5px',
      borderBottomWidth: '1.5px',
    });

    autoResizeTextarea(el);

    expect(el.style.height).toBe('52px');
  });

  it('tolerates empty or non-numeric border widths', () => {
    const el = createTextarea();
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 64 });
    stubComputedStyle(el, {
      boxSizing: 'border-box',
      borderTopWidth: '',
      borderBottomWidth: 'auto',
    });

    expect(() => autoResizeTextarea(el)).not.toThrow();
    // parseCssPixels returns 0 for empty / non-numeric strings, so the
    // border-box adjustment collapses to plain scrollHeight.
    expect(el.style.height).toBe('64px');
  });

  it('ignores the border adjustment when boxSizing is not "border-box"', () => {
    const el = createTextarea();
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 100 });
    stubComputedStyle(el, {
      boxSizing: 'content-box',
      borderTopWidth: '4px',
      borderBottomWidth: '4px',
    });

    autoResizeTextarea(el);

    // Even though borders are set, content-box must NOT include them.
    expect(el.style.height).toBe('100px');
  });
});
