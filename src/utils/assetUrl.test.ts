import { describe, expect, it } from 'vitest';
import { rewriteHtmlImageSources } from '@/utils/assetUrl';

describe('rewriteHtmlImageSources', () => {
  it('rewrites relative image src to workspace files API', () => {
    const html = '<p><img src="images/pic.png" alt="pic" /></p>';
    const rewritten = rewriteHtmlImageSources(html, 'ws_1', 'items/item-1.qti.xml');
    const doc = new DOMParser().parseFromString(rewritten, 'text/html');
    const img = doc.querySelector('img');
    expect(img?.getAttribute('src')).toBe(
      '/api/workspaces/ws_1/files?kind=assessment&name=items%2Fimages%2Fpic.png'
    );
  });

  it('resolves parent segments without escaping root', () => {
    const html = '<img src="../shared/pic.png" />';
    const rewritten = rewriteHtmlImageSources(html, 'ws_1', 'items/section/item-1.qti.xml');
    const doc = new DOMParser().parseFromString(rewritten, 'text/html');
    const img = doc.querySelector('img');
    expect(img?.getAttribute('src')).toBe(
      '/api/workspaces/ws_1/files?kind=assessment&name=items%2Fshared%2Fpic.png'
    );
  });

  it('does not rewrite external or absolute sources', () => {
    const html = [
      '<img src="https://example.com/a.png" />',
      '<img src="data:image/png;base64,aaa" />',
      '<img src="/api/workspaces/ws_1/files?kind=assessment&name=a.png" />',
    ].join('');
    const rewritten = rewriteHtmlImageSources(html, 'ws_1', 'item-1.qti.xml');
    const doc = new DOMParser().parseFromString(rewritten, 'text/html');
    const images = Array.from(doc.querySelectorAll('img'));
    expect(images[0]?.getAttribute('src')).toBe('https://example.com/a.png');
    expect(images[1]?.getAttribute('src')).toBe('data:image/png;base64,aaa');
    expect(images[2]?.getAttribute('src')).toBe(
      '/api/workspaces/ws_1/files?kind=assessment&name=a.png'
    );
  });
});
