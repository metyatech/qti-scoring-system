import { describe, expect, it } from 'vitest';

import { buildScoringItems } from './scoringInput';
import type { QtiItem, QtiResult } from './qtiParsing';

const makeItem = (identifier: string, rubricPoints: number[]) =>
  ({
    identifier,
    title: identifier,
    type: 'descriptive',
    promptHtml: '',
    choices: [],
    rubric: rubricPoints.map((points, index) => ({ index: index + 1, points, text: `c${index + 1}` })),
    candidateExplanationHtml: null,
  }) satisfies QtiItem;

const makeResult = (items: Record<string, { rubricOutcomes?: Record<number, boolean> }>) =>
  ({
    fileName: 'results.xml',
    sourcedId: 's1',
    candidateName: 'user',
    itemResults: Object.fromEntries(
      Object.entries(items).map(([identifier, value]) => [
        identifier,
        {
          resultIdentifier: identifier,
          response: null,
          rubricOutcomes: value.rubricOutcomes ?? {},
        },
      ])
    ),
  }) satisfies QtiResult;

describe('buildScoringItems', () => {
  it('includes all rubric items to keep total score consistent', () => {
    const items = [makeItem('item-1', [1, 2]), makeItem('item-2', [3]), makeItem('item-3', [])];
    const result = makeResult({
      'item-1': { rubricOutcomes: { 1: true, 2: false } },
      'item-2': { rubricOutcomes: { 1: true } },
      'item-3': {},
    });

    const scoringItems = buildScoringItems({
      items,
      result,
      override: { itemId: 'item-1', rubricOutcomes: { 1: false, 2: true } },
    });

    expect(scoringItems).toHaveLength(2);
    expect(scoringItems[0]?.identifier).toBe('item-1');
    expect(scoringItems[1]?.identifier).toBe('item-2');
    expect(scoringItems[0]?.criteria?.map((c) => c.met)).toEqual([false, true]);
    expect(scoringItems[1]?.criteria?.map((c) => c.met)).toEqual([true]);
  });
});
