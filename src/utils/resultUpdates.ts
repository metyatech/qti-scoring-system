import type { QtiResult } from '@/utils/qtiParsing'

export const updateItemComment = (
  results: QtiResult[],
  resultFile: string,
  itemId: string,
  comment: string,
): QtiResult[] => {
  return results.map((result) => {
    if (result.fileName !== resultFile) return result
    const itemResult = result.itemResults[itemId] || {
      resultIdentifier: itemId,
      response: null,
      rubricOutcomes: {},
    }
    return {
      ...result,
      itemResults: {
        ...result.itemResults,
        [itemId]: { ...itemResult, comment },
      },
    }
  })
}

export const buildCriteriaUpdate = (
  rubric: Array<{ index: number }>,
  criterionIndex: number,
  value: boolean,
): Array<{ met?: boolean }> =>
  rubric.map((criterion) => (criterion.index === criterionIndex ? { met: value } : {}))
