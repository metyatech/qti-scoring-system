import type { QtiItem, QtiItemResult } from '@/utils/qtiParsing';

/**
 * Float-safe equality for scores. Rubric points and authored SCORE values are
 * decimals (e.g. 0.1 + 0.2), so a strict `===` mis-classifies a full score as
 * partial: in IEEE-754, `0.1 + 0.2 === 0.30000000000000004`, so `0.3 !== max`
 * even when the SCORE is genuinely 0.3. A naive "round to N decimals" scheme
 * is also wrong: `0.0000004` and `0.00000040` are the same value but a fixed
 * 6-decimal scale would either drop `0.0000004` to 0 or stop short of
 * authorable precision, and scientific-notation inputs like `4e-7` confuse any
 * scheme that infers the scale from `toString()`.
 *
 * The allowed noise class is round-off from a few additions/multiplications
 * of representable decimals — i.e. a small multiple of `Number.EPSILON`
 * (≈ 2^(-52)) of the operand magnitude. The constant `SCORE_EQUAL_ULP_BUDGET`
 * is that multiple (16, i.e. 16× `Number.EPSILON`), a conservative budget
 * that absorbs the worst-case accumulation seen in real QTI scoring paths.
 * Tolerance therefore scales linearly with the magnitude of the operands.
 *
 * Earlier revisions of this helper floored the magnitude at `Math.max(1, …)`.
 * That floor silently injected an absolute tolerance of `Number.EPSILON * 16`
 * (≈ 3.55e-15) into every comparison, even between values near zero. With
 * that floor, a rubric point of `1e-16` (or `Number.MIN_VALUE`) was reported
 * equal to a SCORE of `0`, which made `getEffectiveRubricOutcomes` infer all
 * rubric criteria as `true` on a 0-point score. The floor is replaced with
 * `Number.MIN_VALUE` so sub-normal magnitudes keep a vanishingly small
 * non-zero anchor and genuinely tiny differences are still resolved.
 *
 * Concretely:
 * - `0.1 + 0.2` (≈ `0.30000000000000004`) compares equal to `0.3` — round-off
 *   from a single addition is well within the budget.
 * - `0.25 + 0.75` compares equal to `1` — both operands are exactly
 *   representable binary fractions, so this is bit-identical.
 * - Integer SCOREs (e.g. 3 against a max of 3) remain exact.
 * - Genuinely different values are not absorbed:
 *     * `0` vs `1e-16`           — |diff| is 14 orders of magnitude above the
 *                                  budget at that magnitude.
 *     * `0` vs `Number.MIN_VALUE`— same shape: the gap dwarfs the budget.
 *     * `0.1234560` vs `0.1234564` — |diff| = 4e-7, several orders above the
 *                                    budget at that magnitude.
 *     * `0` vs `0.0000004`         — |diff| = 4e-7, far above the budget.
 *
 * Non-finite inputs (`NaN`, `Infinity`, `-Infinity`) never compare equal to
 * anything, so a corrupted score can never be mis-classified as a rubric max.
 */
const SCORE_EQUAL_ULP_BUDGET = 16;

const decimalEqual = (a: number, b: number): boolean => {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (Object.is(a, b)) return true;
  const difference = Math.abs(a - b);
  const magnitude = Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE);
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
