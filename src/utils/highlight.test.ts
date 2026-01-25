import { describe, expect, it } from 'vitest';
import { highlightCodeBlocks } from '@/utils/highlight';
import { parseQtiItemXml } from '@/utils/qtiParsing';

describe('highlightCodeBlocks', () => {
  it('highlights pre code blocks with deterministic language', () => {
    document.body.innerHTML = `
      <div id="root">
        <pre><code class="language-javascript">const x = 1;</code></pre>
      </div>
    `;
    const root = document.getElementById('root');
    if (!root) throw new Error('root not found');

    const count = highlightCodeBlocks(root);
    expect(count).toBe(1);

    const code = root.querySelector('pre code') as HTMLElement | null;
    expect(code).not.toBeNull();
    expect(code?.classList.contains('hljs')).toBe(true);
    expect(code?.dataset.hljs).toBe('1');
    expect(code?.innerHTML).toContain('hljs-keyword');
    expect(code?.classList.contains('language-javascript')).toBe(true);
  });

  it('highlights without language class via auto detection', () => {
    document.body.innerHTML = `
      <div id="root">
        <pre><code>function add(a, b) { return a + b; }</code></pre>
      </div>
    `;
    const root = document.getElementById('root');
    if (!root) throw new Error('root not found');

    highlightCodeBlocks(root);
    const code = root.querySelector('pre code') as HTMLElement | null;
    expect(code).not.toBeNull();
    expect(code?.classList.contains('hljs')).toBe(true);
    expect(code?.innerHTML).toContain('hljs-');
  });

  it('skips highlighting when blanks are present inside code', () => {
    document.body.innerHTML = `
      <div id="root">
        <pre><code>const <input class="qti-blank-input" data-blank="1" /> = 1;</code></pre>
      </div>
    `;
    const root = document.getElementById('root');
    if (!root) throw new Error('root not found');

    highlightCodeBlocks(root);
    const code = root.querySelector('pre code') as HTMLElement | null;
    expect(code).not.toBeNull();
    expect(code?.dataset.hljs).toBe('skip');
    expect(code?.querySelector('.qti-blank-input')).not.toBeNull();
    expect(code?.classList.contains('hljs')).toBe(false);
  });

  it('highlights qti-pre + qti-code HTML snippets as markup', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="item-html" title="HTML" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
  <qti-item-body>
    <qti-pre>
      <qti-code>&lt;button id="btn"&gt;Click&lt;/button&gt;</qti-code>
    </qti-pre>
  </qti-item-body>
</qti-assessment-item>`;
    const item = parseQtiItemXml(xml);
    document.body.innerHTML = `<div id="root">${item.promptHtml}</div>`;
    const root = document.getElementById('root');
    if (!root) throw new Error('root not found');

    highlightCodeBlocks(root);
    const code = root.querySelector('pre code') as HTMLElement | null;
    expect(code).not.toBeNull();
    expect(code?.classList.contains('hljs')).toBe(true);
    expect(code?.classList.contains('language-xml')).toBe(true);
    expect(code?.innerHTML).toContain('hljs-tag');
  });

  it('does not re-highlight blocks already processed', () => {
    document.body.innerHTML = `
      <div id="root">
        <pre><code class="language-javascript">const y = 2;</code></pre>
      </div>
    `;
    const root = document.getElementById('root');
    if (!root) throw new Error('root not found');

    highlightCodeBlocks(root);
    const code = root.querySelector('pre code') as HTMLElement;
    const firstHtml = code.innerHTML;

    highlightCodeBlocks(root);
    expect(code.innerHTML).toBe(firstHtml);
  });
});
