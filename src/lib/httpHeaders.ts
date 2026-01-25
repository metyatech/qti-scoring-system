export const toAsciiHeaderFallback = (value: string) =>
  value.replace(/[^\x20-\x7E]/g, '_');

export const buildContentDisposition = (originalName: string, fallbackName: string) => {
  const fallback = toAsciiHeaderFallback(fallbackName);
  const encoded = encodeURIComponent(originalName);
  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
};
