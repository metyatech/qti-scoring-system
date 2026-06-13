import { describe, expect, it } from 'vitest';
import type { QtiItem, QtiItemResult } from '@/utils/qtiParsing';
import {
  getEffectiveRubricOutcomes,
  getItemMaxScore,
  getItemScore,
  getRubricScore,
  hasCompleteRubricOutcomes,
} from '@/utils/scoring';

describe('scoring helpers', () => {
  const baseItem: QtiItem = {
    identifier: 'item-1',
    title: 'Item 1',
    type: 'choice',
    promptHtml: '<p>Prompt</p>',
    choices: [],
    rubric: [
      { index: 1, points: 2, text: 'Criterion A' },
      { index: 2, points: 1, text: 'Criterion B' },
    ],
    candidateExplanationHtml: null,
  };

  it('calculates rubric max score', () => {
    expect(getItemMaxScore(baseItem)).toBe(3);
  });

  it('calculates rubric score from outcomes', () => {
    expect(getRubricScore(baseItem, { 1: true, 2: false })).toBe(2);
    expect(getRubricScore(baseItem, { 1: true, 2: true })).toBe(3);
  });

  it('uses rubric outcomes when rubric exists even if score is present', () => {
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'A',
      score: 5,
      rubricOutcomes: { 1: true, 2: true },
    };
    expect(getItemScore(baseItem, result)).toBe(3);
  });

  it('returns null when no result and no rubric data', () => {
    const itemNoRubric: QtiItem = { ...baseItem, rubric: [] };
    expect(getItemScore(itemNoRubric, undefined)).toBeNull();
  });

  it('falls back to rubric score when score is missing', () => {
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'A',
      rubricOutcomes: { 1: false, 2: true },
    };
    expect(getItemScore(baseItem, result)).toBe(1);
  });

  it('uses explicit score when rubric is absent', () => {
    const itemNoRubric: QtiItem = { ...baseItem, rubric: [] };
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'A',
      score: 4,
      rubricOutcomes: {},
    };
    expect(getItemScore(itemNoRubric, result)).toBe(4);
  });

  // ---------------------------------------------------------------------------
  // Fix #1 / #2 / #3 — hasCompleteRubricOutcomes, getItemScore precedence
  // rules, and getEffectiveRubricOutcomes full-score inference.
  // ---------------------------------------------------------------------------

  it('hasCompleteRubricOutcomes is false when any criterion is missing', () => {
    expect(hasCompleteRubricOutcomes(baseItem, { 1: true })).toBe(false);
  });

  it('hasCompleteRubricOutcomes is true when all criteria carry true or false', () => {
    expect(hasCompleteRubricOutcomes(baseItem, { 1: true, 2: false })).toBe(true);
  });

  it('hasCompleteRubricOutcomes is false when the item has no rubric', () => {
    const itemNoRubric: QtiItem = { ...baseItem, rubric: [] };
    expect(hasCompleteRubricOutcomes(itemNoRubric, {})).toBe(false);
  });

  it('getItemScore prefers rubric computation when ALL rubric outcomes are present (even if explicit score disagrees)', () => {
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'A',
      score: 5,
      rubricOutcomes: { 1: true, 2: false },
    };
    // rubric sum: 1*2 + 0*1 = 2 (NOT the explicit score 5)
    expect(getItemScore(baseItem, result)).toBe(2);
  });

  it('getItemScore returns explicit SCORE when rubric outcomes are incomplete and no RUBRIC exists', () => {
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'A',
      score: 2,
      rubricOutcomes: {},
    };
    expect(getItemScore(baseItem, result)).toBe(2);
  });

  it('getItemScore returns explicit SCORE when only some rubric outcomes are true and SCORE is given', () => {
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'A',
      score: 2,
      rubricOutcomes: { 1: true },
    };
    expect(getItemScore(baseItem, result)).toBe(2);
  });

  it('getItemScore returns explicit SCORE when only some rubric outcomes are false and SCORE is given', () => {
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'A',
      score: 2,
      rubricOutcomes: { 2: false },
    };
    expect(getItemScore(baseItem, result)).toBe(2);
  });

  it('getItemScore falls back to summing explicit true outcomes when rubric is incomplete and SCORE is missing', () => {
    // Use a 1pt + 2pt rubric so that summing only the explicit `true` outcome at
    // index 1 yields exactly 1 point. This is the shape of "rubric 1+2" the
    // test description refers to.
    const onePlusTwoItem: QtiItem = {
      ...baseItem,
      rubric: [
        { index: 1, points: 1, text: 'Criterion A' },
        { index: 2, points: 2, text: 'Criterion B' },
      ],
    };
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'A',
      rubricOutcomes: { 1: true },
    };
    // criterion 1 = 1 point (true), criterion 2 = undefined → not summed.
    expect(getItemScore(onePlusTwoItem, result)).toBe(1);
  });

  it('getItemScore returns the explicit SCORE for a no-rubric item', () => {
    const itemNoRubric: QtiItem = { ...baseItem, rubric: [] };
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'A',
      score: 4,
      rubricOutcomes: {},
    };
    expect(getItemScore(itemNoRubric, result)).toBe(4);
  });

  // --- getEffectiveRubricOutcomes: full-score SCORE-only inference (clo) ----

  it('getEffectiveRubricOutcomes infers full true on full-score SCORE-only cloze', () => {
    const clozeItem: QtiItem = { ...baseItem, type: 'cloze' };
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'paris',
      score: 3, // rubric max
      rubricOutcomes: {},
    };
    expect(getEffectiveRubricOutcomes(clozeItem, result)).toEqual({ 1: true, 2: true });
  });

  it('getEffectiveRubricOutcomes returns raw outcomes on partial-score SCORE-only cloze', () => {
    const clozeItem: QtiItem = { ...baseItem, type: 'cloze' };
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'paris',
      score: 2, // partial: not the rubric max
      rubricOutcomes: {},
    };
    expect(getEffectiveRubricOutcomes(clozeItem, result)).toEqual({});
  });

  it('getEffectiveRubricOutcomes returns raw outcomes when any RUBRIC_n_MET exists even at full score', () => {
    const clozeItem: QtiItem = { ...baseItem, type: 'cloze' };
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'paris',
      score: 3, // full score
      rubricOutcomes: { 1: true }, // ...but a partial set of outcomes is present
    };
    expect(getEffectiveRubricOutcomes(clozeItem, result)).toEqual({ 1: true });
  });

  it('getEffectiveRubricOutcomes is a no-op for choice items', () => {
    const choiceItem: QtiItem = { ...baseItem, type: 'choice' };
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'A',
      score: 3, // would be the rubric max
      rubricOutcomes: {},
    };
    // Inference is cloze-only; choice items must never be auto-marked.
    expect(getEffectiveRubricOutcomes(choiceItem, result)).toEqual({});
  });

  it('getEffectiveRubricOutcomes is a no-op for descriptive items', () => {
    const descriptiveItem: QtiItem = { ...baseItem, type: 'descriptive' };
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'A',
      score: 3, // would be the rubric max
      rubricOutcomes: {},
    };
    expect(getEffectiveRubricOutcomes(descriptiveItem, result)).toEqual({});
  });

  it('getEffectiveRubricOutcomes returns raw outcomes when score is absent', () => {
    const clozeItem: QtiItem = { ...baseItem, type: 'cloze' };
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'paris',
      rubricOutcomes: {},
    };
    expect(getEffectiveRubricOutcomes(clozeItem, result)).toEqual({});
  });

  // --- Fix #3: float-safe full-score comparison ----------------------------
  //
  // A 0.1 + 0.2 rubric sums to 0.30000000000000004 in IEEE-754, so a strict
  // `score !== maxScore` mis-classifies an authored SCORE of 0.3 as partial.
  // getEffectiveRubricOutcomes must compare with a small magnitude-scaled
  // Number.EPSILON tolerance so the full-score SCORE-only inference still
  // fires. The cases below pin down the *external* behaviour on the boundary
  // values that motivated the float-safe comparison; the internal
  // `decimalEqual` helper is asserted through its observable effect on
  // `getEffectiveRubricOutcomes` so a future swap is safe.

  const decimalClozeItem = (...points: number[]): QtiItem => ({
    ...baseItem,
    type: 'cloze',
    rubric: points.map((p, i) => ({ index: i + 1, points: p, text: `Criterion ${i + 1}` })),
  });

  it('does NOT infer for a 0.1 + 0.2 rubric at SCORE 0.29 (genuinely partial)', () => {
    // Partial side of the 0.1+0.2 max: below the rubric sum, so inference must
    // not fire even though 0.29 is "close to" 0.3 in human terms.
    const item = decimalClozeItem(0.1, 0.2);
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'paris',
      score: 0.29,
      rubricOutcomes: {},
    };
    expect(getEffectiveRubricOutcomes(item, result)).toEqual({});
  });

  it('decimalEqual: SCORE=0.3 with rubric [0.1, 0.2] infers {1:true, 2:true} (ULP-absorbed 0.1+0.2)', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE-754, so decimalEqual must
    // accept SCORE=0.3 as a full score against that noisy max.
    const item = decimalClozeItem(0.1, 0.2);
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'paris',
      score: 0.3,
      rubricOutcomes: {},
    };
    expect(getEffectiveRubricOutcomes(item, result)).toEqual({ 1: true, 2: true });
  });

  it('decimalEqual: SCORE=1e-16 with rubric [1e-16] infers {1:true} (bit-identical, ULP-anchor floors tiny values without swallowing the gap)', () => {
    // Object.is(1e-16, 1e-16) is true, so the equality short-circuits before
    // the ULP-budget comparison. With the previous `Math.max(1, ...)` floor
    // a 1e-16 vs 0 comparison was also reported equal, which is the regression
    // this test pins down (covered separately below).
    const item = decimalClozeItem(1e-16);
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'paris',
      score: 1e-16,
      rubricOutcomes: {},
    };
    expect(getEffectiveRubricOutcomes(item, result)).toEqual({ 1: true });
  });

  it('decimalEqual: SCORE=0 against rubric [1e-16] does NOT infer (genuine gap, 0 ≠ 1e-16)', () => {
    // Regression: the previous `Math.max(1, ...)` floor injected an absolute
    // tolerance of ~3.55e-15 into every comparison, so 0 vs 1e-16 was
    // misreported as equal and every rubric criterion was wrongly inferred
    // true on a 0-point score. The Number.MIN_VALUE anchor now scales the
    // tolerance with the operand magnitude, so the tolerance is many orders
    // of magnitude smaller than the 1e-16 gap and inference must NOT fire.
    const item = decimalClozeItem(1e-16);
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'paris',
      score: 0,
      rubricOutcomes: {},
    };
    expect(getEffectiveRubricOutcomes(item, result)).toEqual({});
  });

  it('decimalEqual: SCORE=0 against rubric [Number.MIN_VALUE] does NOT infer (genuine gap, 0 ≠ MIN_VALUE)', () => {
    // Same shape as the 1e-16 regression but with the smallest positive
    // double. Object.is short-circuits MIN_VALUE vs MIN_VALUE (covered below
    // by the bit-identical cases); here we assert the non-equal pair.
    const item = decimalClozeItem(Number.MIN_VALUE);
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'paris',
      score: 0,
      rubricOutcomes: {},
    };
    expect(getEffectiveRubricOutcomes(item, result)).toEqual({});
  });

  it('decimalEqual: SCORE=0 against rubric [0.0000004] does NOT infer (4e-7 is far above the ULP budget)', () => {
    // 0 vs 0.0000004 has |diff| = 4e-7; magnitude = 4e-7; tolerance is
    // ~Number.EPSILON * 4e-7 * 16 ≈ 1.43e-21, so the gap is ~14 orders of
    // magnitude above the budget. Inference must NOT fire.
    const item = decimalClozeItem(0.0000004);
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'paris',
      score: 0,
      rubricOutcomes: {},
    };
    expect(getEffectiveRubricOutcomes(item, result)).toEqual({});
  });

  it('decimalEqual: SCORE=0.0000004 against rubric [0.0000004] infers {1:true} (bit-identical)', () => {
    // Object.is(0.0000004, 0.0000004) is true, so this short-circuits to equal.
    const item = decimalClozeItem(0.0000004);
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'paris',
      score: 0.0000004,
      rubricOutcomes: {},
    };
    expect(getEffectiveRubricOutcomes(item, result)).toEqual({ 1: true });
  });

  it('decimalEqual: SCORE=0.1234560 against rubric [0.1234564] does NOT infer (4e-7 > ULP budget)', () => {
    // |diff| = 4e-7, magnitude = 0.1234564, tolerance ~ 8.76e-16. The gap is
    // nine orders of magnitude above the budget; the helper must report no
    // inference so the criterion stays undefined.
    const item = decimalClozeItem(0.1234564);
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'paris',
      score: 0.1234560,
      rubricOutcomes: {},
    };
    expect(getEffectiveRubricOutcomes(item, result)).toEqual({});
  });

  it('decimalEqual: SCORE=1 against rubric [0.25, 0.75] infers {1:true, 2:true} (float-noisy but exact equal)', () => {
    // 0.25 + 0.75 === 1 exactly in IEEE-754 (both are representable binary
    // fractions), so this exercises the "max === 1" branch with no float noise.
    const item = decimalClozeItem(0.25, 0.75);
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'paris',
      score: 1,
      rubricOutcomes: {},
    };
    expect(getEffectiveRubricOutcomes(item, result)).toEqual({ 1: true, 2: true });
  });

  it('decimalEqual: integer rubric (max=3) at SCORE=3 infers {1:true, 2:true} (integer path intact)', () => {
    // baseItem is 1pt + 2pt; SCORE=3 is bit-identical to the rubric max.
    const clozeItem: QtiItem = { ...baseItem, type: 'cloze' };
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'paris',
      score: 3,
      rubricOutcomes: {},
    };
    expect(getEffectiveRubricOutcomes(clozeItem, result)).toEqual({ 1: true, 2: true });
  });

  it('decimalEqual: SCORE=NaN against rubric [0.1, 0.2] does NOT infer (NaN can never be a full score)', () => {
    const item = decimalClozeItem(0.1, 0.2);
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'paris',
      score: NaN,
      rubricOutcomes: {},
    };
    expect(getEffectiveRubricOutcomes(item, result)).toEqual({});
  });

  it('decimalEqual: SCORE=Infinity against rubric [0.1, 0.2] does NOT infer (+Inf is not a finite score)', () => {
    const item = decimalClozeItem(0.1, 0.2);
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'paris',
      score: Infinity,
      rubricOutcomes: {},
    };
    expect(getEffectiveRubricOutcomes(item, result)).toEqual({});
  });

  it('decimalEqual: SCORE=-Infinity against rubric [0.1, 0.2] does NOT infer (-Inf is not a finite score)', () => {
    // -Inf is a separate failure mode from +Inf: a corrupted signed score must
    // never be mis-classified as a rubric max regardless of sign.
    const item = decimalClozeItem(0.1, 0.2);
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'paris',
      score: -Infinity,
      rubricOutcomes: {},
    };
    expect(getEffectiveRubricOutcomes(item, result)).toEqual({});
  });

  it('decimalEqual: full-score SCORE with one RUBRIC_n_MET present returns raw outcomes (explicit-wins rule still holds)', () => {
    // Re-confirm the "any explicit outcome present" rule still wins after the
    // float-safe comparison change: the raw outcomes are returned verbatim
    // (1: true), no inference is layered on top of the missing criterion 2.
    const item = decimalClozeItem(0.1, 0.2);
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'paris',
      score: 0.3,
      rubricOutcomes: { 1: true },
    };
    expect(getEffectiveRubricOutcomes(item, result)).toEqual({ 1: true });
  });
});
