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
  // getEffectiveRubricOutcomes must compare with decimal-scale rounding so the
  // full-score SCORE-only inference still fires.

  const decimalClozeItem = (...points: number[]): QtiItem => ({
    ...baseItem,
    type: 'cloze',
    rubric: points.map((p, i) => ({ index: i + 1, points: p, text: `Criterion ${i + 1}` })),
  });

  it('infers full true for a 0.1 + 0.2 rubric at SCORE 0.3 (float-noisy max)', () => {
    const item = decimalClozeItem(0.1, 0.2); // getItemMaxScore === 0.30000000000000004
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'paris',
      score: 0.3,
      rubricOutcomes: {},
    };
    expect(getEffectiveRubricOutcomes(item, result)).toEqual({ 1: true, 2: true });
  });

  it('does NOT infer for a 0.1 + 0.2 rubric at SCORE 0.29 (genuinely partial)', () => {
    const item = decimalClozeItem(0.1, 0.2);
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'paris',
      score: 0.29,
      rubricOutcomes: {},
    };
    expect(getEffectiveRubricOutcomes(item, result)).toEqual({});
  });

  it('infers full true for a 0.25 + 0.75 rubric at SCORE 1', () => {
    const item = decimalClozeItem(0.25, 0.75); // max === 1
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'paris',
      score: 1,
      rubricOutcomes: {},
    };
    expect(getEffectiveRubricOutcomes(item, result)).toEqual({ 1: true, 2: true });
  });

  it('still infers full true for an integer rubric at full score (decimalEqual is exact on integers)', () => {
    const clozeItem: QtiItem = { ...baseItem, type: 'cloze' }; // 2 + 1 = 3
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'paris',
      score: 3,
      rubricOutcomes: {},
    };
    expect(getEffectiveRubricOutcomes(clozeItem, result)).toEqual({ 1: true, 2: true });
  });

  it('does NOT infer for a 0.1 + 0.2 full-score rubric when a RUBRIC_n_MET is already present', () => {
    // The "any explicit outcome present" rule wins before the full-score
    // inference is even considered, so the raw outcomes are returned verbatim.
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
