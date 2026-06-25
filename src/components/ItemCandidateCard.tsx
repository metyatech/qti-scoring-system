"use client";

import { memo } from "react";
import AutoResizeTextarea from "@/components/AutoResizeTextarea";
import RubricScoringControl from "@/components/RubricScoringControl";
import CommentSaveStatusIndicator from "@/components/CommentSaveStatusIndicator";
import type { CommentSaveStatus } from "@/hooks/useCommentAutoSave";
import type { QtiItem, QtiResult } from "@/utils/qtiParsing";
import { formatResponse } from "@/utils/formatResponse";
import { getEffectiveRubricOutcomes, getItemMaxScore, getItemScore } from "@/utils/scoring";
import { makeCommentKey, makeCriterionKey } from "@/utils/workspaceKeys";

type ItemCandidateCardProps = {
  item: QtiItem;
  result: QtiResult;
  resultIndex: number;
  resultCount: number;
  criterionSaveStatusByKey: Record<string, "saving" | "saved">;
  commentSaveStatusByKey: Record<string, CommentSaveStatus>;
  onToggleCriterion: (
    resultFile: string,
    itemId: string,
    criterionIndex: number,
    value: boolean
  ) => void | Promise<void>;
  onCommentChange: (resultFile: string, itemId: string, comment: string) => void;
  onCommentBlur: (
    resultFile: string,
    itemId: string,
    comment: string
  ) => void | Promise<void>;
};

/**
 * Single-candidate card rendered inside the item-view scroll region.
 *
 * Memoised so the parent (page.tsx) can hold the wrapped `EdgeScrollCandidateNavigator`
 * open while a parent state change does not invalidate the entire card. The
 * gate logic only depends on `result.fileName`, `item.identifier`,
 * `currentResultIndex`, and the four callbacks — when none of those change
 * the card is reused without re-rendering.
 */
function ItemCandidateCardImpl({
  item,
  result,
  resultIndex,
  resultCount,
  criterionSaveStatusByKey,
  commentSaveStatusByKey,
  onToggleCriterion,
  onCommentChange,
  onCommentBlur,
}: ItemCandidateCardProps) {
  const itemResult = result.itemResults[item.identifier];
  const responseText = formatResponse(item, itemResult);
  const comment = itemResult?.comment ?? "";
  const itemScore = getItemScore(item, itemResult);
  const commentKey = makeCommentKey(result.fileName, item.identifier);
  const commentStatus = commentSaveStatusByKey[commentKey];
  const rubric = item.rubric;
  const itemMaxScore = getItemMaxScore(item);

  return (
    <div
      data-testid="item-candidate-card"
      data-result-file={result.fileName}
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-5 py-4">
        <div className="flex flex-col gap-1">
          <span
            className="inline-flex w-fit items-center rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white shadow-sm"
            data-testid="item-card-candidate-counter"
          >
            受講者 {resultIndex + 1} / {resultCount}
          </span>
          <span className="text-base font-semibold text-slate-900">
            {result.candidateName}
          </span>
          <span className="text-xs text-slate-500">
            {result.sourcedId || result.fileName}
          </span>
        </div>
        {rubric.length > 0 && (
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200">
            得点: {itemScore ?? 0} / {itemMaxScore}
          </span>
        )}
      </header>

      <div className="space-y-4 p-5 sm:p-6">
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">回答</h3>
          <div className="whitespace-pre-wrap text-sm leading-6 text-slate-800">
            {responseText}
          </div>
        </section>

        {rubric.length > 0 && (
          <>
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">採点基準</h3>
                <span className="text-xs text-slate-500">{rubric.length}項目</span>
              </div>
              <div className="space-y-2">
                {rubric.map((criterion) => {
                  const value = getEffectiveRubricOutcomes(item, itemResult)[criterion.index];
                  const criterionKey = makeCriterionKey(
                    result.fileName,
                    item.identifier,
                    criterion.index
                  );
                  const criterionStatus = criterionSaveStatusByKey[criterionKey];
                  return (
                    <RubricScoringControl
                      key={criterion.index}
                      item={item}
                      criterion={criterion}
                      value={value}
                      saveStatus={criterionStatus}
                      saveStatusTestId={`save-status-${result.fileName}-${item.identifier}-criterion-${criterion.index}`}
                      onChange={(next) =>
                        onToggleCriterion(result.fileName, item.identifier, criterion.index, next)
                      }
                    />
                  );
                })}
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-2 flex items-center justify-between">
                <label
                  className="block text-sm font-semibold text-slate-700"
                  htmlFor={`comment-input-${result.fileName}-${item.identifier}`}
                  data-testid={`comment-label-${result.fileName}-${item.identifier}`}
                >
                  コメント
                </label>
                <CommentSaveStatusIndicator
                  status={commentStatus}
                  testId={`save-status-${result.fileName}-${item.identifier}-comment`}
                />
              </div>
              <AutoResizeTextarea
                id={`comment-input-${result.fileName}-${item.identifier}`}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-800 shadow-inner focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={2}
                value={comment}
                onChange={(value) => onCommentChange(result.fileName, item.identifier, value)}
                onBlur={(value) => onCommentBlur(result.fileName, item.identifier, value)}
              />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

const ItemCandidateCard = memo(ItemCandidateCardImpl);
export default ItemCandidateCard;
