import { describe, expect, it } from 'vitest';
import type { QtiItem, QtiItemResult } from '@/utils/qtiParsing';
import { getItemMaxScore, getItemScore, getRubricScore } from '@/utils/scoring';

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

  it('prefers explicit score when provided', () => {
    const result: QtiItemResult = {
      resultIdentifier: 'item-1',
      response: 'A',
      score: 5,
      rubricOutcomes: { 1: true },
    };
    expect(getItemScore(baseItem, result)).toBe(5);
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
});
