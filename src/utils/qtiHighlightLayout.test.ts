import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseQtiItemXml } from '@/utils/qtiParsing';
import { highlightCodeBlocks } from '@/utils/highlight';

const REAL_ITEM_PATH = 'src/utils/__fixtures__/real-item.qti.xml';

const loadCss = (cssPath: string) => {
  const cssText = fs.readFileSync(cssPath, 'utf-8');
  const style = document.createElement('style');
  style.textContent = cssText;
  document.head.appendChild(style);
  return style;
};

describe('highlight theme layout with blanks', () => {
  it('overrides highlight.js block display for code segments', () => {
    const highlightCssPath = path.resolve(
      process.cwd(),
      'node_modules/highlight.js/styles/github-dark.css'
    );
    const globalsCssPath = path.resolve(process.cwd(), 'src/app/globals.css');
    const highlightStyle = loadCss(highlightCssPath);
    const globalsStyle = loadCss(globalsCssPath);

    const xml = fs.readFileSync(path.resolve(process.cwd(), REAL_ITEM_PATH), 'utf-8');
    const item = parseQtiItemXml(xml);
    const root = document.createElement('div');
    root.className = 'qti-prompt';
    root.innerHTML = item.promptHtml;

    highlightCodeBlocks(root);

    const pre = Array.from(root.querySelectorAll('pre')).find((node) =>
      node.classList.contains('qti-pre-with-blanks')
    );
    expect(pre).not.toBeUndefined();
    const code = pre?.querySelector('code.hljs') as HTMLElement | null;
    expect(code).not.toBeNull();

    const computed = getComputedStyle(code as HTMLElement);
    expect(computed.display).toBe('inline');

    globalsStyle.remove();
    highlightStyle.remove();
  });
});
