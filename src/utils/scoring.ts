import type { QtiItem, QtiItemResult } from '@/utils/qtiParsing';

export const getItemMaxScore = (item: QtiItem): number => {
  return item.rubric.reduce((sum, criterion) => sum + (Number.isFinite(criterion.points) ? criterion.points : 0), 0);
};

export const getRubricScore = (item: QtiItem, rubricOutcomes: Record<number, boolean>): number => {
  return item.rubric.reduce((sum, criterion) => sum + (rubricOutcomes[criterion.index] ? criterion.points : 0), 0);
};

/**
 * True when every rubric criterion of the item carries an explicit `true` or
 * `false` outcome. An item with no rubric is never "complete" (there is nothing
 * to be complete about); callers must branch on `item.rubric.length` first when
 * they care about that case.
 */
export const hasCompleteRubricOutcomes = (
  item: QtiItem,
  rubricOutcomes: Record<number, boolean>
): boolean => {
  if (item.rubric.length === 0) return false;
  return item.rubric.every((criterion) => typeof rubricOutcomes[criterion.index] === 'boolean');
};

/**
 * True when the item carries no explicit rubric outcome at all (every criterion
 * is `undefined`).
 */
const hasNoExplicitRubricOutcomes = (
  item: QtiItem,
  rubricOutcomes: Record<number, boolean>
): boolean => {
  return item.rubric.every((criterion) => rubricOutcomes[criterion.index] === undefined);
};

/**
 * Effective rubric outcomes used for both display and score calculation.
 *
 * This mirrors the full-score SCORE-only inference that `apply-to-qti-results`
 * performs when it writes the Results XML: for a cloze item that has a rubric,
 * an explicit SCORE equal to the rubric maximum, and NO `RUBRIC_n_MET` outcomes
 * at all, every criterion is treated as `true`. This lets the GUI show the
 * correct (locked) state from the very first render, before any PUT has
 * materialised the rubric outcomes into the file.
 *
 * Partial scores are never inferred: when only some (or none, but below max)
 * outcomes are present, the raw outcomes are returned unchanged so undefined
 * criteria stay undefined (未判定) rather than being guessed.
 */
export const getEffectiveRubricOutcomes = (
  item: QtiItem,
  itemResult?: QtiItemResult
): Record<number, boolean> => {
  const outcomes = itemResult?.rubricOutcomes ?? {};
  if (item.type !== 'cloze') return outcomes;
  if (item.rubric.length === 0) return outcomes;
  if (!hasNoExplicitRubricOutcomes(item, outcomes)) return outcomes;
  if (!itemResult || typeof itemResult.score !== 'number') return outcomes;
  const maxScore = getItemMaxScore(item);
  if (maxScore <= 0 || itemResult.score !== maxScore) return outcomes;
  const inferred: Record<number, boolean> = {};
  for (const criterion of item.rubric) {
    inferred[criterion.index] = true;
  }
  return inferred;
};

/**
 * Resolve the displayed score for an item.
 *
 * - No rubric: the explicit `itemResult.score` is authoritative.
 * - Rubric with a COMPLETE set of outcomes (after full-score inference): the
 *   rubric calculation is authoritative, even if it disagrees with the explicit
 *   SCORE.
 * - Rubric with an INCOMPLETE set of outcomes: the explicit `itemResult.score`
 *   wins when present, so a SCORE-only file (no / partial `RUBRIC_n_MET`) keeps
 *   its real score instead of being under-counted from the few known criteria.
 * - Rubric with an incomplete set and no explicit score: fall back to summing
 *   the points of the criteria that are explicitly `true`.
 */
export const getItemScore = (item: QtiItem, itemResult?: QtiItemResult): number | null => {
  if (!itemResult) return null;
  if (item.rubric.length > 0) {
    const outcomes = getEffectiveRubricOutcomes(item, itemResult);
    if (hasCompleteRubricOutcomes(item, outcomes)) {
      return getRubricScore(item, outcomes);
    }
    if (typeof itemResult.score === 'number') return itemResult.score;
    return getRubricScore(item, outcomes);
  }
  if (typeof itemResult.score === 'number') return itemResult.score;
  return null;
};
