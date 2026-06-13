import {
  extractTestResultScore,
  parseQtiResultsXml,
  remapResultToAssessmentItems,
  type QtiItemResult,
  type QtiResult,
} from "@/utils/qtiParsing";
import type { AssessmentItemRef } from "qti-xml-core";

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
  /**
   * Parsed `qti-assessment-item-ref` entries from the workspace's
   * `assessment-test.qti.xml`. The Results Reporting XML's `itemResult`
   * identifiers do not necessarily match the assessment item identifiers
   * (they may be linked only by `sequenceIndex` or by a `Q<n>` pattern), so
   * the helper remaps the saved result onto the assessment items via
   * `remapResultToAssessmentItems` before matching against
   * `requestedIdentifiers`.
   *
   * Throws a typed `Error` on any of the following — the route layer is
   * expected to surface these as 500 responses so the frontend can roll
   * back its optimistic update rather than silently accepting a sparse row:
   *
   *   1. An `itemResult` in the saved XML could not be matched to any
   *      `assessment-item-ref` (e.g. an unknown `sequenceIndex` and no
   *      identifier or `Q<n>` match).
   *   2. Multiple `itemResult`s in the saved XML mapped to the same
   *      assessment item (ambiguous remap).
   *   3. A `requestedIdentifier` does not exist in the assessment-test
   *      item refs (the caller asked for an item the test does not
   *      contain).
   *   4. A `requestedIdentifier` exists in the assessment-test but has no
   *      mapped `itemResult` in the saved XML (the caller's update was
   *      not persisted).
   */
  assessmentTestRefs: AssessmentItemRef[];
}

/**
 * Build the JSON body for the PUT /results route by re-parsing the saved
 * Results Reporting XML. Returns the rubricOutcomes / score / comment that the
 * server actually wrote, so the frontend can replace its optimistic state
 * with the ground truth.
 *
 * `requestedIdentifiers` are matched against the **assessment item**
 * identifiers (resolved via `remapResultToAssessmentItems` from the parsed
 * `assessmentTestRefs`), not against the raw `itemResult@identifier` in the
 * Results XML. This is what lets the helper cope with results whose
 * `itemResult@identifier` differs from the assessment item identifier and is
 * linked only by `sequenceIndex` or a `Q<n>` pattern.
 *
 * `testScore` is the whole-test total, not just the updated items: it prefers
 * the authoritative `testResult/SCORE` written by apply-to-qti-results and
 * falls back to summing the SCORE of *every* itemResult in the saved file. It
 * is never summed over only the requested identifiers, so updating one item in
 * a multi-item test still reports the full test score.
 *
 * Throws if the saved XML is unparsable or any of the four invariant
 * violations documented on `BuildResultUpdateResponseInput.assessmentTestRefs`
 * fires; the caller should turn those into 500 responses. The helper itself
 * never returns a "failed" shape — it is the caller's job to return
 * `{ success: true, ... }` only on success.
 */
export const buildResultUpdateResponse = ({
  savedXml,
  fileName,
  requestedIdentifiers,
  assessmentTestRefs,
}: BuildResultUpdateResponseInput): ResultUpdateResponse => {
  const result = parseQtiResultsXml(savedXml, fileName);
  const { mappedItemResults, missingResultIdentifiers, duplicateItemIdentifiers } =
    remapResultToAssessmentItems(result, assessmentTestRefs);

  if (missingResultIdentifiers.length > 0) {
    throw new Error(
      `itemResult${missingResultIdentifiers.length > 1 ? "s" : ""} ` +
        `${missingResultIdentifiers.map((id) => `"${id}"`).join(", ")} ` +
        `could not be matched to any assessment item in the assessment-test XML`,
    );
  }
  if (duplicateItemIdentifiers.length > 0) {
    throw new Error(
      `multiple itemResults mapped to the same assessment item(s) ` +
        `${duplicateItemIdentifiers.map((id) => `"${id}"`).join(", ")}`,
    );
  }

  const knownItemIdentifiers = new Set(assessmentTestRefs.map((ref) => ref.identifier));
  const items: ResultUpdateItem[] = [];
  for (const identifier of requestedIdentifiers) {
    if (!knownItemIdentifiers.has(identifier)) {
      throw new Error(
        `requested identifier "${identifier}" is not an item in the assessment-test XML`,
      );
    }
    const itemResult: QtiItemResult | undefined = mappedItemResults[identifier];
    if (!itemResult) {
      // The server did not produce an itemResult for this assessment item.
      // We refuse to emit a sparse row: returning success with empty data
      // would erase the caller's just-saved UI state. The route turns this
      // into a 500 so the frontend can roll back its optimistic update.
      throw new Error(
        `requested identifier "${identifier}" was not saved in the Results XML`,
      );
    }
    items.push({
      identifier,
      rubricOutcomes: { ...itemResult.rubricOutcomes },
      score: typeof itemResult.score === 'number' ? itemResult.score : null,
      comment: itemResult.comment ?? null,
    });
  }

  return {
    success: true,
    items,
    testScore: computeTestScore(savedXml, result),
  };
};

/**
 * Resolve the whole-test score from the saved Results Reporting XML. Prefers
 * the authoritative `testResult/SCORE`; when that outcome is absent, sums the
 * SCORE of every itemResult in the document (not just the requested ones).
 */
const computeTestScore = (savedXml: string, result: QtiResult): number | null => {
  const testResultScore = extractTestResultScore(savedXml);
  if (testResultScore !== null) {
    return testResultScore;
  }
  const itemScores = Object.values(result.itemResults)
    .map((itemResult) => itemResult.score)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return itemScores.length > 0 ? itemScores.reduce((sum, value) => sum + value, 0) : null;
};
