"use client";

import { memo } from "react";
import AutoResizeTextarea from "@/components/AutoResizeTextarea";
import RubricScoringControl from "@/components/RubricScoringControl";
import type { QtiItem, QtiResult } from "@/utils/qtiParsing";
import { formatResponse } from "@/utils/formatResponse";
import { getEffectiveRubricOutcomes, getItemMaxScore, getItemScore } from "@/utils/scoring";
import { makeCommentKey, makeCriterionKey } from "@/utils/workspaceKeys";

type ItemCandidateCardProps = {
  item: QtiItem;
  result: QtiResult;
  resultIndex: number;
  resultCount: number;
  saveStatusByKey: Record<string, "saving" | "saved">;
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
  saveStatusByKey,
  onToggleCriterion,
  onCommentChange,
  onCommentBlur,
}: ItemCandidateCardProps) {
  const itemResult = result.itemResults[item.identifier];
  const responseText = formatResponse(item, itemResult);
  const comment = itemResult?.comment ?? "";
  const itemScore = getItemScore(item, itemResult);
  const commentKey = makeCommentKey(result.fileName, item.identifier);
  const commentStatus = saveStatusByKey[commentKey];
  const rubric = item.rubric;
  const itemMaxScore = getItemMaxScore(item);

  return (
    <div
      data-testid="item-candidate-card"
      data-result-file={result.fileName}
      className="bg-white border rounded-lg p-6 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="bg-blue-600 text-white text-sm font-bold px-3 py-1 rounded-md"
            data-testid="item-card-candidate-counter"
          >
            受講者 {resultIndex + 1} / {resultCount}
          </span>
          <span className="text-base font-semibold text-gray-800">{result.candidateName}</span>
          <span className="text-xs text-gray-500">
            {result.sourcedId || result.fileName}
          </span>
        </div>
        {rubric.length > 0 && (
          <span className="text-sm text-gray-600">
            得点: <span className="text-blue-600">{itemScore ?? 0}</span> / {itemMaxScore}
          </span>
        )}
      </div>

      <div className="bg-gray-50 rounded-lg p-4 border-l-4 border-blue-500 text-sm text-gray-800 whitespace-pre-wrap">
        {responseText}
      </div>

      {rubric.length > 0 && (
        <div className="mt-5 border-t pt-4">
          <div className="text-xs text-gray-500 mb-2">採点基準</div>
          <div className="space-y-2">
            {rubric.map((criterion) => {
              const value = getEffectiveRubricOutcomes(item, itemResult)[criterion.index];
              const criterionKey = makeCriterionKey(
                result.fileName,
                item.identifier,
                criterion.index
              );
              const criterionStatus = saveStatusByKey[criterionKey];
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
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <label
                className="block text-xs font-medium text-gray-600"
                data-testid={`comment-label-${result.fileName}-${item.identifier}`}
              >
                コメント
              </label>
              {commentStatus && (
                <span
                  className={`text-xs ${commentStatus === "saving" ? "text-gray-500" : "text-green-600"}`}
                  data-testid={`save-status-${result.fileName}-${item.identifier}-comment`}
                  aria-live="polite"
                >
                  {commentStatus === "saving" ? "保存中..." : "保存しました"}
                </span>
              )}
            </div>
            <AutoResizeTextarea
              className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={2}
              value={comment}
              onChange={(value) => onCommentChange(result.fileName, item.identifier, value)}
              onBlur={(value) => onCommentBlur(result.fileName, item.identifier, value)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

const ItemCandidateCard = memo(ItemCandidateCardImpl);
export default ItemCandidateCard;
