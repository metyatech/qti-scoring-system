import { parseQtiResultsXml } from "@/utils/qtiParsing";
import type { QtiItemResult } from "@/utils/qtiParsing";

export interface ResultUpdateItem {
  identifier: string;
  rubricOutcomes: Record<number, boolean>;
  score: number | null;
  comment: string | null;
}

export interface ResultUpdateResponse {
  success: true;
  items: ResultUpdateItem[];
  testScore: number | null;
}

export interface BuildResultUpdateResponseInput {
  savedXml: string;
  fileName: string;
  requestedIdentifiers: string[];
}

/**
 * Build the JSON body for the PUT /results route by re-parsing the saved
 * Results Reporting XML. Returns the rubricOutcomes / score / comment that the
 * server actually wrote, so the frontend can replace its optimistic state
 * with the ground truth. `testScore` is computed by summing the per-item
 * SCORE values (matching how the apply-to-qti-results CLI keeps the test
 * total in sync).
 *
 * Throws if the saved XML is unparsable; the caller should turn that into a
 * 500 response. The helper itself never returns a "failed" shape — it is the
 * caller's job to return `{ success: true, ... }` only on success.
 */
export const buildResultUpdateResponse = ({
  savedXml,
  fileName,
  requestedIdentifiers,
}: BuildResultUpdateResponseInput): ResultUpdateResponse => {
  const result = parseQtiResultsXml(savedXml, fileName);
  const items: ResultUpdateItem[] = [];
  for (const identifier of requestedIdentifiers) {
    const itemResult: QtiItemResult | undefined = result.itemResults[identifier];
    if (!itemResult) {
      // The server did not produce an itemResult for this identifier. We
      // intentionally emit a sparse row so the frontend can clear local
      // state for that identifier without a "missing key" flicker.
      items.push({
        identifier,
        rubricOutcomes: {},
        score: null,
        comment: null,
      });
      continue;
    }
    items.push({
      identifier,
      rubricOutcomes: { ...itemResult.rubricOutcomes },
      score: typeof itemResult.score === 'number' ? itemResult.score : null,
      comment: itemResult.comment ?? null,
    });
  }

  const itemScores = items
    .map((entry) => entry.score)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const testScore = itemScores.length > 0 ? itemScores.reduce((sum, value) => sum + value, 0) : null;

  return {
    success: true,
    items,
    testScore,
  };
};
