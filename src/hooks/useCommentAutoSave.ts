import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { makeCommentKey } from "@/utils/workspaceKeys";

/**
 * Notion-style comment autosave statuses.
 *
 * - `saving`   — an edit happened and a save is pending or in flight.
 * - `retrying` — the last save attempt failed and an automatic retry is queued.
 * - `saved`    — the latest value is confirmed on the server (shown briefly).
 *
 * `undefined` (absent from the map) means "nothing to show": either no edit has
 * happened yet, or the last `saved` flash has elapsed.
 */
export type CommentSaveStatus = "saving" | "retrying" | "saved";

type CommentSaveEntry = {
  resultFile: string;
  itemId: string;
  /** Most recent value the user has typed (drives what eventually persists). */
  latestValue: string;
  /** Last value confirmed by a successful PUT, or null before any success. */
  confirmedValue: string | null;
  debounceTimer: number | null;
  retryTimer: number | null;
  savedTimer: number | null;
  /** True while a PUT for this key is awaiting a response. */
  inFlight: boolean;
  failureCount: number;
};

const DEFAULT_DEBOUNCE_MS = 800;
const DEFAULT_SAVED_VISIBLE_MS = 2000;

/**
 * Exponential backoff capped at 10s: 1s, 2s, 4s, 8s, 10s, 10s, ...
 */
const getRetryDelayMs = (failureCount: number) => {
  const delay = 1000 * Math.pow(2, Math.max(0, failureCount - 1));
  return Math.min(delay, 10_000);
};

type UseCommentAutoSaveOptions = {
  debounceMs?: number;
  savedVisibleMs?: number;
  persistComment: (resultFile: string, itemId: string, comment: string) => Promise<void>;
  applyLocalComment: (resultFile: string, itemId: string, comment: string) => void;
};

type UseCommentAutoSaveResult = {
  commentSaveStatusByKey: Record<string, CommentSaveStatus>;
  hasUnsettledCommentSaves: boolean;
  scheduleCommentSave: (resultFile: string, itemId: string, comment: string) => void;
  flushCommentSave: (resultFile: string, itemId: string, comment: string) => void;
};

/**
 * Notion-style comment autosave hook.
 *
 * Responsibilities:
 * - Reflect the typed comment locally immediately (via `applyLocalComment`).
 * - Debounce per-keystroke saves (default 800ms) and flush immediately on blur.
 * - Persist only through `persistComment` (a results-XML PUT); the value is only
 *   considered saved after that PUT resolves.
 * - Show a brief `保存しました` flash on success, retry with exponential backoff
 *   on failure, and never roll back the on-screen value.
 * - Preserve ordering: a save in flight is never raced by a second parallel PUT;
 *   if newer input arrives while saving, the latest value is re-saved afterward
 *   so the last typed value wins.
 * - Arm a `beforeunload` guard while any comment is still `saving`/`retrying`.
 *
 * No comment body or draft is ever written to any browser storage.
 */
export function useCommentAutoSave(
  options: UseCommentAutoSaveOptions
): UseCommentAutoSaveResult {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const savedVisibleMs = options.savedVisibleMs ?? DEFAULT_SAVED_VISIBLE_MS;

  // Keep the latest callbacks in refs so the stable save machinery below never
  // captures a stale closure even when the caller passes inline functions.
  const persistCommentRef = useRef(options.persistComment);
  const applyLocalCommentRef = useRef(options.applyLocalComment);
  useEffect(() => {
    persistCommentRef.current = options.persistComment;
    applyLocalCommentRef.current = options.applyLocalComment;
  });

  const entriesRef = useRef<Record<string, CommentSaveEntry>>({});
  const [commentSaveStatusByKey, setCommentSaveStatusByKey] = useState<
    Record<string, CommentSaveStatus>
  >({});

  const setStatus = useCallback((key: string, status: CommentSaveStatus | null) => {
    setCommentSaveStatusByKey((prev) => {
      if (status === null) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      if (prev[key] === status) return prev;
      return { ...prev, [key]: status };
    });
  }, []);

  const getEntry = useCallback(
    (resultFile: string, itemId: string): CommentSaveEntry => {
      const key = makeCommentKey(resultFile, itemId);
      let entry = entriesRef.current[key];
      if (!entry) {
        entry = {
          resultFile,
          itemId,
          latestValue: "",
          confirmedValue: null,
          debounceTimer: null,
          retryTimer: null,
          savedTimer: null,
          inFlight: false,
          failureCount: 0,
        };
        entriesRef.current[key] = entry;
      }
      return entry;
    },
    []
  );

  const clearTimers = useCallback((entry: CommentSaveEntry) => {
    if (entry.debounceTimer !== null) {
      window.clearTimeout(entry.debounceTimer);
      entry.debounceTimer = null;
    }
    if (entry.retryTimer !== null) {
      window.clearTimeout(entry.retryTimer);
      entry.retryTimer = null;
    }
    if (entry.savedTimer !== null) {
      window.clearTimeout(entry.savedTimer);
      entry.savedTimer = null;
    }
  }, []);

  // The save routine is self-recursive (re-save when the value changed during
  // a save, retry on failure). It is invoked through a ref so the recursive
  // references do not touch the `runSave` binding before it is initialised.
  const runSaveRef = useRef<(resultFile: string, itemId: string) => void>(
    () => {}
  );

  const runSave = useCallback(
    (resultFile: string, itemId: string) => {
      const key = makeCommentKey(resultFile, itemId);
      const entry = entriesRef.current[key];
      if (!entry) return;
      // Never issue a parallel PUT; the in-flight completion handler re-saves
      // the latest value if it changed while the request was outstanding.
      if (entry.inFlight) return;

      // Nothing new to persist — drop any lingering status.
      if (entry.confirmedValue === entry.latestValue) {
        setStatus(key, null);
        return;
      }

      const valueToSave = entry.latestValue;
      entry.inFlight = true;
      // We are about to persist the latest value now, so any pending debounce
      // for this key is moot. Clearing it prevents a late debounce firing after
      // the save resolves and clobbering the "保存しました" flash via the
      // "nothing new to persist" early-return above.
      if (entry.debounceTimer !== null) {
        window.clearTimeout(entry.debounceTimer);
        entry.debounceTimer = null;
      }

      persistCommentRef.current(resultFile, itemId, valueToSave).then(
        () => {
          entry.inFlight = false;
          // Re-save only when the final value actually changed while this PUT
          // was in flight. A same-value blur/flush must NOT trigger a redundant
          // re-save nor suppress the "保存しました" flash, so the decision is
          // based purely on the value — never on an edit counter.
          if (entry.latestValue !== valueToSave) {
            setStatus(key, "saving");
            runSaveRef.current(resultFile, itemId);
            return;
          }
          entry.confirmedValue = valueToSave;
          entry.failureCount = 0;
          setStatus(key, "saved");
          if (entry.savedTimer !== null) {
            window.clearTimeout(entry.savedTimer);
          }
          entry.savedTimer = window.setTimeout(() => {
            entry.savedTimer = null;
            if (entry.confirmedValue === entry.latestValue) {
              setStatus(key, null);
            }
          }, savedVisibleMs);
        },
        () => {
          // Save failed: keep the on-screen value as-is (never roll back),
          // surface the retry state, and schedule an automatic retry.
          entry.inFlight = false;
          entry.failureCount += 1;
          setStatus(key, "retrying");
          if (entry.retryTimer !== null) {
            window.clearTimeout(entry.retryTimer);
          }
          entry.retryTimer = window.setTimeout(() => {
            entry.retryTimer = null;
            runSaveRef.current(resultFile, itemId);
          }, getRetryDelayMs(entry.failureCount));
        }
      );
    },
    [savedVisibleMs, setStatus]
  );

  useEffect(() => {
    runSaveRef.current = runSave;
  }, [runSave]);

  const scheduleCommentSave = useCallback(
    (resultFile: string, itemId: string, comment: string) => {
      const key = makeCommentKey(resultFile, itemId);
      const entry = getEntry(resultFile, itemId);
      applyLocalCommentRef.current(resultFile, itemId, comment);
      entry.latestValue = comment;
      clearTimers(entry);
      setStatus(key, "saving");
      entry.debounceTimer = window.setTimeout(() => {
        entry.debounceTimer = null;
        runSave(resultFile, itemId);
      }, debounceMs);
    },
    [clearTimers, debounceMs, getEntry, runSave, setStatus]
  );

  const flushCommentSave = useCallback(
    (resultFile: string, itemId: string, comment: string) => {
      const key = makeCommentKey(resultFile, itemId);
      const entry = getEntry(resultFile, itemId);
      applyLocalCommentRef.current(resultFile, itemId, comment);
      entry.latestValue = comment;
      clearTimers(entry);
      setStatus(key, "saving");
      runSave(resultFile, itemId);
    },
    [clearTimers, getEntry, runSave, setStatus]
  );

  const hasUnsettledCommentSaves = useMemo(
    () =>
      Object.values(commentSaveStatusByKey).some(
        (status) => status === "saving" || status === "retrying"
      ),
    [commentSaveStatusByKey]
  );

  // Arm the browser's native unload warning only while a save is unsettled.
  useEffect(() => {
    if (!hasUnsettledCommentSaves) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsettledCommentSaves]);

  // Clear every outstanding timer on unmount.
  useEffect(() => {
    const entries = entriesRef.current;
    return () => {
      Object.values(entries).forEach((entry) => {
        if (entry.debounceTimer !== null) window.clearTimeout(entry.debounceTimer);
        if (entry.retryTimer !== null) window.clearTimeout(entry.retryTimer);
        if (entry.savedTimer !== null) window.clearTimeout(entry.savedTimer);
      });
    };
  }, []);

  return {
    commentSaveStatusByKey,
    hasUnsettledCommentSaves,
    scheduleCommentSave,
    flushCommentSave,
  };
}
