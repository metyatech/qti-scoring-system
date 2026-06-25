import type { CommentSaveStatus } from "@/hooks/useCommentAutoSave";

type CommentSaveStatusIndicatorProps = {
  status?: CommentSaveStatus;
  testId: string;
};

const STATUS_TEXT: Record<CommentSaveStatus, string> = {
  saving: "保存中...",
  retrying: "保存を再試行中...",
  saved: "保存しました",
};

/**
 * Comment-only autosave status badge (Notion-style).
 *
 * Renders nothing until there is something to report. `saving` / `retrying`
 * show an animated spinner; `saved` shows a brief confirmation with no spinner.
 * This component is intentionally NOT shared with the rubric criterion save
 * status, which has its own two-state ("saving" / "saved") indicator.
 */
export default function CommentSaveStatusIndicator({
  status,
  testId,
}: CommentSaveStatusIndicatorProps) {
  if (!status) return null;

  const showSpinner = status === "saving" || status === "retrying";
  const textColor = status === "saved" ? "text-emerald-600" : "text-slate-500";

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs ${textColor}`}
      data-testid={testId}
      aria-live="polite"
    >
      {showSpinner && (
        <span
          aria-hidden="true"
          className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {STATUS_TEXT[status]}
    </span>
  );
}
