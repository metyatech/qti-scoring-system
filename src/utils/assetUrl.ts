import { resolveRelativePath } from 'qti-xml-core';

const isExternalSource = (src: string) =>
  /^(?:[a-z]+:)?\/\//i.test(src) || src.startsWith('data:') || src.startsWith('/');

const buildWorkspaceFileUrl = (workspaceId: string, name: string) =>
  `/api/workspaces/${workspaceId}/files?kind=assessment&name=${encodeURIComponent(name)}`;

export const rewriteHtmlImageSources = (
  html: string,
  workspaceId: string,
  baseFilePath: string
): string => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const images = doc.querySelectorAll('img[src]');
  images.forEach((img) => {
    const rawSrc = img.getAttribute('src');
    if (!rawSrc || isExternalSource(rawSrc)) return;
    const resolved = resolveRelativePath(baseFilePath, rawSrc);
    if (!resolved) return;
    img.setAttribute('src', buildWorkspaceFileUrl(workspaceId, resolved));
  });
  return doc.body.innerHTML;
};
