import type { QtiItem, QtiItemResult } from '@/utils/qtiParsing';
import { getItemScore } from '@/utils/scoring';

export const computeOptimisticItemResultScore = (
  item: QtiItem,
  itemResult: QtiItemResult,
  nextRubricOutcomes: Record<number, boolean>
): number | null => {
  const optimisticItemResult = {
    ...itemResult,
    rubricOutcomes: nextRubricOutcomes,
  };
  return getItemScore(item, optimisticItemResult);
};
