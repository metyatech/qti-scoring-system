import { describe, expect, it } from 'vitest';
import type { QtiItem, QtiItemResult } from '@/utils/qtiParsing';
import { computeOptimisticItemResultScore } from '@/utils/optimisticScore';

const makeItem = (type: QtiItem['type']): QtiItem => ({
  identifier: 'item-1',
  title: 'Item 1',
  type,
  promptHtml: '<p>Prompt</p>',
  choices: [],
  rubric: [
    { index: 1, points: 1, text: 'Criterion 1' },
    { index: 2, points: 2, text: 'Criterion 2' },
  ],
  candidateExplanationHtml: null,
});

const makeResult = (overrides: Partial<QtiItemResult>): QtiItemResult => ({
  resultIdentifier: 'item-1',
  response: 'answer',
  rubricOutcomes: {},
  ...overrides,
});

describe('computeOptimisticItemResultScore', () => {
  it('keeps SCORE=2 when a SCORE-only cloze gets one 1-point criterion set true', () => {
    const item = makeItem('cloze');
    const result = makeResult({ score: 2, rubricOutcomes: {} });

    expect(computeOptimisticItemResultScore(item, result, { 1: true })).toBe(2);
  });

  it('does not lower SCORE=2 when a partial explicit rubric adds criterion 2 as true', () => {
    const item = makeItem('cloze');
    const result = makeResult({ score: 2, rubricOutcomes: { 1: true } });

    expect(computeOptimisticItemResultScore(item, result, { 1: true, 2: true })).toBeGreaterThanOrEqual(2);
  });

  it('uses rubric calculation for a descriptive item once the full rubric is present', () => {
    const item = makeItem('descriptive');
    const result = makeResult({ score: 2, rubricOutcomes: { 1: true } });

    expect(computeOptimisticItemResultScore(item, result, { 1: true, 2: true })).toBe(3);
  });

  it('sums explicit true rubric outcomes when SCORE is absent and the rubric is partial', () => {
    const item = makeItem('cloze');
    const result = makeResult({ rubricOutcomes: {} });

    expect(computeOptimisticItemResultScore(item, result, { 1: true })).toBe(1);
  });
});
