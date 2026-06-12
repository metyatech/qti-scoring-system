export type QtiItemType = 'descriptive' | 'choice' | 'cloze';

export interface QtiChoice {
  identifier: string;
  text: string;
}

export interface QtiRubricCriterion {
  index: number;
  points: number;
  text: string;
}

export interface QtiItem {
  identifier: string;
  title: string;
  type: QtiItemType;
  promptHtml: string;
  choices: QtiChoice[];
  rubric: QtiRubricCriterion[];
  candidateExplanationHtml: string | null;
}

export interface QtiItemResult {
  resultIdentifier: string;
  sequenceIndex?: number;
  response: string | string[] | null;
  score?: number;
  comment?: string;
  rubricOutcomes: Record<number, boolean>;
}

export interface QtiResult {
  fileName: string;
  sourcedId: string;
  candidateName: string;
  itemResults: Record<string, QtiItemResult>;
}

import { XMLParser } from 'fast-xml-parser';
import { renderQtiItemForScoring } from 'qti-html-renderer';
import {
  parseAssessmentTestXml as parseAssessmentTestXmlCore,
  parseResultsXmlRaw,
  resolveAssessmentHref as resolveAssessmentHrefCore,
  type AssessmentItemRef,
} from 'qti-xml-core';

const testResultScoreParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: true,
  parseAttributeValue: false,
});

const readOutcomeValueText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const text = (value as Record<string, unknown>)['#text'];
    if (text === null || text === undefined) return null;
    return String(text);
  }
  return null;
};

/**
 * Extract the whole-test SCORE from the `testResult` element of a Results
 * Reporting XML document. Returns `null` when the document has no parseable
 * `testResult/SCORE` outcome. This is the authoritative test total written by
 * `apply-to-qti-results`; callers should prefer it over summing item scores.
 */
export const extractTestResultScore = (xml: string): number | null => {
  let parsed: unknown;
  try {
    parsed = testResultScoreParser.parse(xml);
  } catch {
    return null;
  }
  const assessmentResult = (parsed as Record<string, unknown> | undefined)?.assessmentResult as
    | Record<string, unknown>
    | undefined;
  const testResult = assessmentResult?.testResult as Record<string, unknown> | undefined;
  if (!testResult) return null;
  const outcomes = testResult.outcomeVariable;
  const outcomeList = Array.isArray(outcomes) ? outcomes : outcomes ? [outcomes] : [];
  for (const outcome of outcomeList) {
    if (!outcome || typeof outcome !== 'object') continue;
    const record = outcome as Record<string, unknown>;
    if (record['@_identifier'] !== 'SCORE') continue;
    const text = readOutcomeValueText(record.value);
    if (text === null || text.trim() === '') continue;
    const numeric = Number(text);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
};

export interface RemapResult {
  mappedItemResults: Record<string, QtiItemResult>;
  missingResultIdentifiers: string[];
  duplicateItemIdentifiers: string[];
}

export const parseQtiItemXml = (xml: string): QtiItem => {
  const parsed = renderQtiItemForScoring(xml);
  const hasChoice = parsed.choices.length > 0;
  const hasCloze = parsed.promptHtml.includes('qti-blank-input');
  const type: QtiItemType = hasChoice ? 'choice' : hasCloze ? 'cloze' : 'descriptive';

  return {
    identifier: parsed.identifier,
    title: parsed.title,
    type,
    promptHtml: parsed.promptHtml,
    choices: parsed.choices,
    rubric: parsed.rubricCriteria,
    candidateExplanationHtml: parsed.candidateExplanationHtml,
  };
};

export const parseQtiResultsXml = (xml: string, fileName: string): QtiResult => {
  const raw = parseResultsXmlRaw(xml);
  const sourcedId = raw.sourcedId;
  let candidateName = sourcedId || fileName;
  const candidateFromSession = raw.sessionIdentifiers['candidateName'];
  if (candidateFromSession) {
    candidateName = candidateFromSession;
  }

  const itemResults: Record<string, QtiItemResult> = {};
  for (const itemResult of raw.itemResults) {
    const resultIdentifier = itemResult.identifier;
    const responseValues = itemResult.responseVariables['RESPONSE'] ?? [];
    let response: string | string[] | null = null;
    if (responseValues.length === 1) response = responseValues[0];
    else if (responseValues.length > 1) response = responseValues;

    const scoreValues = itemResult.outcomeVariables['SCORE'] ?? [];
    const scoreValue = scoreValues[0];
    const commentValues = itemResult.outcomeVariables['COMMENT'] ?? [];
    const commentValue = commentValues[0];

    const rubricOutcomes: Record<number, boolean> = {};
    for (const [identifier, values] of Object.entries(itemResult.outcomeVariables)) {
      const match = identifier.match(/^RUBRIC_(\d+)_MET$/);
      if (!match) continue;
      const idx = Number(match[1]);
      const value = values[0];
      if (value === 'true') rubricOutcomes[idx] = true;
      if (value === 'false') rubricOutcomes[idx] = false;
    }

    itemResults[resultIdentifier] = {
      resultIdentifier,
      sequenceIndex: itemResult.sequenceIndex,
      response,
      score: scoreValue ? Number(scoreValue) : undefined,
      comment: commentValue ?? undefined,
      rubricOutcomes,
    };
  }

  return {
    fileName,
    sourcedId,
    candidateName,
    itemResults,
  };
};

export const parseAssessmentTestXml = (xml: string): AssessmentItemRef[] => {
  try {
    return parseAssessmentTestXmlCore(xml);
  } catch (error) {
    throw new Error((error as Error).message || 'assessmentTest XML の解析に失敗しました');
  }
};

export const resolveAssessmentHref = (assessmentTestPath: string, href: string): string => {
  try {
    return resolveAssessmentHrefCore(assessmentTestPath, href);
  } catch (error) {
    throw new Error((error as Error).message || '不正な相対パスです');
  }
};

export const remapResultToAssessmentItems = (
  result: QtiResult,
  itemRefs: AssessmentItemRef[]
): RemapResult => {
  const mappedItemResults: Record<string, QtiItemResult> = {};
  const missingResultIdentifiers: string[] = [];
  const duplicateItemIdentifiers: string[] = [];
  const itemIdentifiers = new Map<string, number>();
  itemRefs.forEach((ref, index) => itemIdentifiers.set(ref.identifier, index + 1));
  const itemCount = itemRefs.length;

  const mapByIndex = (index: number | undefined) => {
    if (!index || index < 1 || index > itemCount) return null;
    return itemRefs[index - 1].identifier;
  };

  const mapByQ = (resultIdentifier: string) => {
    const match = resultIdentifier.match(/^Q(\d+)$/i);
    if (!match) return null;
    const index = Number(match[1]);
    return mapByIndex(index);
  };

  for (const itemResult of Object.values(result.itemResults)) {
    const bySequence = mapByIndex(itemResult.sequenceIndex);
    const byIdentifier = itemIdentifiers.has(itemResult.resultIdentifier)
      ? itemResult.resultIdentifier
      : null;
    const byQ = mapByQ(itemResult.resultIdentifier);
    const itemIdentifier = bySequence || byIdentifier || byQ;
    if (!itemIdentifier) {
      missingResultIdentifiers.push(itemResult.resultIdentifier);
      continue;
    }
    if (mappedItemResults[itemIdentifier]) {
      duplicateItemIdentifiers.push(itemIdentifier);
      continue;
    }
    mappedItemResults[itemIdentifier] = itemResult;
  }

  return { mappedItemResults, missingResultIdentifiers, duplicateItemIdentifiers };
};
