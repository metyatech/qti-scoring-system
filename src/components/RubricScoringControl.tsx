import React from "react";
import type { QtiItem, QtiRubricCriterion } from "@/utils/qtiParsing";

type RubricValue = boolean | undefined;

export type RubricScoringControlProps = {
  item: QtiItem;
  criterion: QtiRubricCriterion;
  value: RubricValue;
  onChange: (value: boolean) => void;
  /**
   * Save feedback for this single criterion. The parent owns the optimistic UI
   * state ("保存中..." / "保存しました") and passes the current status string
   * through here so the badge is rendered consistently across views.
   */
  saveStatus?: "saving" | "saved";
  /**
   * Identifier used for the save-status test id so existing e2e fixtures keep
   * working. Required when `saveStatus` is rendered.
   */
  saveStatusTestId?: string;
};

/**
 * Shared rubric-scoring control. The presentation branches on `item.type`:
 *
 * - `choice` items expose a `qti-choice-interaction` and are auto-scored by
 *   the apply-to-qti-results pipeline. The GUI MUST NOT offer a clickable
 *   toggle for the rubric; it only shows the saved auto-score plus a small
 *   "編集不可" hint. The user can still edit the comment textarea.
 * - `cloze` items expose `qti-text-entry-interaction` and may be partially
 *   correct. To avoid user confusion, the rubric is one-way: a scorer may
 *   flip `false → true` (正答に変更) but the reverse direction is hidden in
 *   the UI. Once `true`, a static message is rendered instead of any button.
 * - everything else (`descriptive`) keeps the original 〇 / × toggle.
 */
export default function RubricScoringControl({
  item,
  criterion,
  value,
  onChange,
  saveStatus,
  saveStatusTestId,
}: RubricScoringControlProps) {
  const renderSaveStatus = () => {
    if (!saveStatus) return null;
    return (
      <span
        className={`text-xs ${saveStatus === "saving" ? "text-gray-500" : "text-green-600"}`}
        data-testid={saveStatusTestId}
        aria-live="polite"
      >
        {saveStatus === "saving" ? "保存中..." : "保存しました"}
      </span>
    );
  };

  const renderCriterionLabel = () => (
    <span className="text-xs text-gray-700">
      [{criterion.points}] {criterion.text}
    </span>
  );

  if (item.type === "choice") {
    const met = value === true;
    return (
      <div className="flex items-center gap-2" data-testid="rubric-choice-readonly">
        <span
          className={`px-2 py-1 rounded text-xs border ${
            met
              ? "bg-green-600 text-white border-green-600"
              : "bg-red-600 text-white border-red-600"
          }`}
          data-testid="rubric-choice-badge"
        >
          自動採点結果: {met ? "○" : "×"}
        </span>
        <span className="text-xs text-gray-500">編集不可</span>
        {renderCriterionLabel()}
        {renderSaveStatus()}
      </div>
    );
  }

  if (item.type === "cloze") {
    if (value === true) {
      return (
        <div className="flex items-center gap-2" data-testid="rubric-cloze-locked">
          <span className="px-2 py-1 rounded text-xs border bg-green-600 text-white border-green-600">
            現在: ○
          </span>
          <span className="text-xs text-gray-500">正答から誤答には変更できません</span>
          {renderCriterionLabel()}
          {renderSaveStatus()}
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2" data-testid="rubric-cloze-upgradeable">
        <span className="px-2 py-1 rounded text-xs border bg-red-600 text-white border-red-600">
          現在: ×
        </span>
        <button
          type="button"
          onClick={() => onChange(true)}
          className="px-2 py-1 rounded text-xs border bg-white text-gray-600 border-gray-300 hover:bg-green-50"
        >
          正答に変更
        </button>
        {renderCriterionLabel()}
        {renderSaveStatus()}
      </div>
    );
  }

  // descriptive (and any future default) — keep the historical 〇 / × toggle.
  return (
    <div className="flex items-center gap-2" data-testid="rubric-descriptive">
      <button
        type="button"
        onClick={() => onChange(true)}
        className={`px-2 py-1 rounded text-xs border ${
          value === true
            ? "bg-green-600 text-white border-green-600"
            : "bg-white text-gray-600 border-gray-300"
        }`}
      >
        〇
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`px-2 py-1 rounded text-xs border ${
          value === false
            ? "bg-red-600 text-white border-red-600"
            : "bg-white text-gray-600 border-gray-300"
        }`}
      >
        ×
      </button>
      {renderCriterionLabel()}
      {renderSaveStatus()}
    </div>
  );
}
