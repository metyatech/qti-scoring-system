/**
 * Stable keys used to look up the optimistic save-status of a single
 * comment or rubric criterion in `page.tsx`'s `saveStatusByKey` map.
 *
 * Extracted so the keys can be shared between `page.tsx`,
 * `ItemCandidateCard`, and any other consumer without duplicating the
 * format string in multiple places.
 */
export const makeCommentKey = (resultFile: string, itemId: string) =>
  `${resultFile}::${itemId}::comment`;

export const makeCriterionKey = (
  resultFile: string,
  itemId: string,
  criterionIndex: number
) => `${resultFile}::${itemId}::criterion::${criterionIndex}`;
