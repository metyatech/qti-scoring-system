import type { QtiItem, QtiItemResult } from '@/utils/qtiParsing';

/**
 * Float-safe equality for scores. Rubric points and authored SCORE values are
 * decimals (e.g. 0.1 + 0.2), so a strict `===` mis-classifies a full score as
 * partial. The previous integer-scaled `Math.round(a * 10^n)` design was
 * fundamentally broken: it capped the scale at 6 (so 0.0000004 truncated to 0)
 * and parsed `value.toString()` for the scale, which silently mis-categorised
 * numbers in scientific notation (e.g. `4e-7` is "no decimal point" and
 * therefore scale 0).
 *
 * This implementation compares the relative + absolute difference against a
 * small multiple of `Number.EPSILON`. It only ever returns true when the
 * operands are bit-identical, a few ULPs apart (so `0.1 + 0.2` ≈ 0.3), or
 * essentially zero. Any genuinely different decimal — e.g. 0 vs 0.0000004,
 * 0.1234560 vs 0.1234564 — has a difference orders of magnitude larger than
 * the tolerance and is reported as not-equal.
 *
 * Non-finite inputs (`NaN`, `Infinity`, `-Infinity`) never compare equal to
 * anything, so a corrupted score can never be mis-classified as a rubric max.
 *
 * The coefficient (16) is a conservative multiple of `Number.EPSILON`
 * (≈ 2^(-52)) that absorbs at most ~4 ULPs of accumulated float-representation
 * noise from a few additions or multiplications, which is the worst case seen
 * in real QTI scoring paths. It is not a "fixed big epsilon" — the actual
 * tolerance scales linearly with the magnitude of the operands.
 */
const SCORE_EQUAL_ULP_BUDGET = 16;

const decimalEqual = (a: number, b: number): boolean => {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (Object.is(a, b)) return true;
  const difference = Math.abs(a - b);
  const magnitude = Math.max(1, Math.abs(a), Math.abs(b));
  return difference <= Number.EPSILON * magnitude * SCORE_EQUAL_ULP_BUDGET;
};

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
  if (maxScore <= 0 || !decimalEqual(itemResult.score, maxScore)) return outcomes;
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
