import type { QtiItem, QtiItemResult } from '@/utils/qtiParsing';

export const getItemMaxScore = (item: QtiItem): number => {
  return item.rubric.reduce((sum, criterion) => sum + (Number.isFinite(criterion.points) ? criterion.points : 0), 0);
};

export const getRubricScore = (item: QtiItem, rubricOutcomes: Record<number, boolean>): number => {
  return item.rubric.reduce((sum, criterion) => sum + (rubricOutcomes[criterion.index] ? criterion.points : 0), 0);
};

export const getItemScore = (item: QtiItem, itemResult?: QtiItemResult): number | null => {
  if (typeof itemResult?.score === 'number') return itemResult.score;
  if (!itemResult || item.rubric.length === 0) return null;
  return getRubricScore(item, itemResult.rubricOutcomes);
};
