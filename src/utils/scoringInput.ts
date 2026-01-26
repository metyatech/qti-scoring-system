import type { QtiItem, QtiResult } from './qtiParsing';

export type ScoringItem = {
  identifier: string;
  criteria?: Array<{
    met: boolean;
    criterionText?: string;
  }>;
  comment?: string;
};

export type ScoringOverride = {
  itemId: string;
  rubricOutcomes?: Record<number, boolean>;
  comment?: string | null;
};

export const buildScoringItems = (params: {
  items: QtiItem[];
  result: QtiResult | null;
  override?: ScoringOverride;
}): ScoringItem[] => {
  const { items, result, override } = params;
  if (!result) return [];

  const scoringItems: ScoringItem[] = [];
  for (const item of items) {
    const itemResult = result.itemResults[item.identifier];
    const isTarget = override?.itemId === item.identifier;

    if (item.rubric.length === 0) {
      const comment = isTarget ? override?.comment : undefined;
      if (typeof comment === 'string' && comment.trim().length > 0) {
        scoringItems.push({ identifier: item.identifier, comment });
      }
      continue;
    }

    const baseOutcomes = itemResult?.rubricOutcomes ?? {};
    const rubricOutcomes = isTarget && override?.rubricOutcomes ? override.rubricOutcomes : baseOutcomes;
    const criteria = item.rubric.map((criterion) => ({
      met: rubricOutcomes[criterion.index] ?? false,
      criterionText: criterion.text,
    }));

    const entry: ScoringItem = { identifier: item.identifier, criteria };
    const comment = isTarget ? override?.comment : undefined;
    if (typeof comment === 'string' && comment.trim().length > 0) {
      entry.comment = comment;
    }
    scoringItems.push(entry);
  }

  return scoringItems;
};
