const normalizeRelativePath = (value: string): string | null => {
  const parts = value.replace(/\\/g, '/').split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join('/');
};

const getBaseDir = (filePath: string) => {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  segments.pop();
  return segments.join('/');
};

const resolveRelativePath = (baseFilePath: string, relativePath: string): string | null => {
  const baseDir = getBaseDir(baseFilePath);
  const combined = baseDir ? `${baseDir}/${relativePath}` : relativePath;
  return normalizeRelativePath(combined);
};

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

