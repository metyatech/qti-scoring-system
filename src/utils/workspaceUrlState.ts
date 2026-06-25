/**
 * URL query state for the workspace page.
 *
 * The workspace page is a `"use client"` component, so it can read and write
 * `window.location` directly without going through `useSearchParams`. We
 * intentionally avoid the React Router here because:
 *
 * - We do NOT want a real Next.js navigation on every state change. Only the
 *   URL bar should update, which `history.replaceState` achieves without
 *   re-running the page's load effect.
 * - We do NOT want to push a new history entry on every navigation. The user
 *   expects "次へ" to move forward in the URL, but the back button should
 *   still take them out of the page rather than cycling through candidates.
 *
 * Only the persistent UI state is encoded in the URL: the active view mode,
 * the active candidate result file, the active item identifier, and whether
 * the details panel is shown. Transient UI (saving indicators, drafts, scroll
 * position, modals, errors) MUST NOT be encoded here.
 */

export type WorkspaceViewMode = "item" | "candidate";

export type ParsedWorkspaceUrlState = {
  viewMode?: WorkspaceViewMode;
  resultFile?: string;
  itemId?: string;
  showBasicInfo?: boolean;
};

export type ResolvedWorkspaceUrlState = {
  viewMode: WorkspaceViewMode;
  currentResultIndex: number;
  currentItemIndex: number;
  showBasicInfo: boolean;
};

export type WorkspaceUrlStateInput = {
  viewMode: WorkspaceViewMode;
  resultFile?: string;
  itemId?: string;
  showBasicInfo: boolean;
};

const VIEW_MODES: ReadonlySet<WorkspaceViewMode> = new Set(["item", "candidate"]);

const normalizeSearch = (search: string): string => {
  // Strip a single leading "?" if the caller passed a raw `location.search`
  // value. Anything else is passed through unchanged so that `URLSearchParams`
  // can do its own parsing.
  if (search.startsWith("?")) return search.slice(1);
  return search;
};

const isNonEmptyString = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.length > 0;

export const parseWorkspaceUrlState = (
  search: string
): ParsedWorkspaceUrlState => {
  const params = new URLSearchParams(normalizeSearch(search));

  const rawView = params.get("view");
  const viewMode: WorkspaceViewMode | undefined =
    rawView !== null && VIEW_MODES.has(rawView as WorkspaceViewMode)
      ? (rawView as WorkspaceViewMode)
      : undefined;

  const rawResult = params.get("result");
  const resultFile = isNonEmptyString(rawResult) ? rawResult : undefined;

  const rawItem = params.get("item");
  const itemId = isNonEmptyString(rawItem) ? rawItem : undefined;

  const rawDetails = params.get("details");
  const showBasicInfo = rawDetails === "1" ? true : undefined;

  return { viewMode, resultFile, itemId, showBasicInfo };
};

/**
 * Map parsed query state to concrete React state values.
 *
 * The page has separate `items` and `results` arrays. We translate the
 * stable-keyed query (`resultFile`, `itemId`) into indices, and fall back to
 * index 0 when the key is missing or no longer matches anything in the loaded
 * workspace. This makes URL restoration tolerant of stale URLs (e.g. a
 * workspace where a result file was renamed or removed between visits).
 */
export const resolveWorkspaceUrlState = (
  parsed: ParsedWorkspaceUrlState,
  results: ReadonlyArray<{ fileName: string }>,
  items: ReadonlyArray<{ identifier: string }>
): ResolvedWorkspaceUrlState => {
  const viewMode: WorkspaceViewMode = parsed.viewMode ?? "item";

  let currentResultIndex = 0;
  if (parsed.resultFile) {
    const foundIndex = results.findIndex(
      (result) => result.fileName === parsed.resultFile
    );
    if (foundIndex >= 0) currentResultIndex = foundIndex;
  }

  let currentItemIndex = 0;
  if (parsed.itemId) {
    const foundIndex = items.findIndex(
      (item) => item.identifier === parsed.itemId
    );
    if (foundIndex >= 0) currentItemIndex = foundIndex;
  }

  const showBasicInfo = parsed.showBasicInfo === true;

  return {
    viewMode,
    currentResultIndex,
    currentItemIndex,
    showBasicInfo,
  };
};

/**
 * Build a URL query string from the current workspace state.
 *
 * Always emits `view`; only emits `result`/`item` when their values are
 * non-empty; only emits `details=1` when the details panel is visible. The
 * returned string has NO leading "?" so callers can concatenate it with
 * `pathname?` themselves.
 */
export const buildWorkspaceUrlSearch = (
  state: WorkspaceUrlStateInput
): string => {
  const params = new URLSearchParams();
  params.set("view", state.viewMode);

  if (isNonEmptyString(state.resultFile)) {
    params.set("result", state.resultFile);
  }

  if (isNonEmptyString(state.itemId)) {
    params.set("item", state.itemId);
  }

  if (state.showBasicInfo) {
    params.set("details", "1");
  }

  return params.toString();
};
