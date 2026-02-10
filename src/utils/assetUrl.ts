import { rewriteHtmlImageSources as rewriteHtmlImageSourcesCore } from "qti-html-renderer";

const buildWorkspaceFileUrl = (workspaceId: string, name: string) =>
  `/api/workspaces/${workspaceId}/files?kind=assessment&name=${encodeURIComponent(name)}`;

export const rewriteHtmlImageSources = (
  html: string,
  workspaceId: string,
  baseFilePath: string
): string =>
  rewriteHtmlImageSourcesCore(html, baseFilePath, {
    resolveUrl: (resolved) => buildWorkspaceFileUrl(workspaceId, resolved),
  });
