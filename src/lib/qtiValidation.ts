import path from "path";
import {
  extractItemIdentifier as extractItemIdentifierCore,
  parseAssessmentItemRefsFromXml,
  parseResultItemRefsFromXml,
  type AssessmentItemRef,
  type ResultItemRef,
} from "qti-xml-core";
import { resolveAssessmentHref } from "@/utils/qtiParsing";

export const extractItemIdentifier = (xml: string): string | null =>
  extractItemIdentifierCore(xml);

type AssessmentItemRefResolved = AssessmentItemRef & { resolvedHref: string };

const extractAssessmentItemRefs = (
  xml: string
): { itemRefs: AssessmentItemRef[]; errors: string[] } => {
  const parsed = parseAssessmentItemRefsFromXml(xml);
  const errors = parsed.errors.map((error) =>
    error.code === "missing-itemref-identifier-or-href"
      ? "assessmentTest の itemRef に identifier / href がありません"
      : "assessmentTest に itemRef がありません"
  );
  return { itemRefs: parsed.itemRefs, errors };
};

const extractResultItemRefs = (
  xml: string
): { itemRefs: ResultItemRef[]; errors: string[] } => {
  const parsed = parseResultItemRefsFromXml(xml);
  const errors = parsed.errors.map((error) => {
    if (error.code === "missing-itemresult-identifier") {
      return "results の itemResult に identifier がありません";
    }
    if (error.code === "invalid-sequence-index") {
      return `results の sequenceIndex が不正です: ${error.identifier}`;
    }
    return "results XML から itemResult が取得できません";
  });
  return { itemRefs: parsed.itemRefs, errors };
};

const detectDuplicateIdentifiers = (
  itemRefs: AssessmentItemRef[]
): string[] => {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const ref of itemRefs) {
    if (seen.has(ref.identifier)) {
      duplicates.push(ref.identifier);
      continue;
    }
    seen.add(ref.identifier);
  }
  return duplicates;
};

const resolveItemRefs = (
  assessmentTestPath: string,
  itemRefs: AssessmentItemRef[],
  assessmentFiles: Map<string, string>
): { resolved: AssessmentItemRefResolved[]; errors: string[] } => {
  const resolved: AssessmentItemRefResolved[] = [];
  const errors: string[] = [];

  const basenameToPath = new Map<string, string>();
  const duplicateBasenames = new Set<string>();
  for (const filePath of assessmentFiles.keys()) {
    const base = path.posix.basename(filePath);
    if (!base) continue;
    if (basenameToPath.has(base)) {
      duplicateBasenames.add(base);
      continue;
    }
    basenameToPath.set(base, filePath);
  }

  for (const ref of itemRefs) {
    let resolvedHref: string;
    try {
      resolvedHref = resolveAssessmentHref(assessmentTestPath, ref.href);
    } catch (error) {
      errors.push(
        error instanceof Error
          ? error.message
          : "assessmentTest の href が不正です"
      );
      continue;
    }
    let itemXml = assessmentFiles.get(resolvedHref);
    if (!itemXml) {
      const base = path.posix.basename(resolvedHref);
      if (duplicateBasenames.has(base)) {
        errors.push(
          `assessmentTest が参照する item が一意に特定できません: ${ref.href}`
        );
        continue;
      }
      const fallbackPath = basenameToPath.get(base);
      if (fallbackPath) {
        resolvedHref = fallbackPath;
        itemXml = assessmentFiles.get(fallbackPath);
      }
    }
    if (!itemXml) {
      errors.push(`assessmentTest が参照する item がありません: ${ref.href}`);
      continue;
    }
    const itemIdentifier = extractItemIdentifier(itemXml);
    if (!itemIdentifier) {
      errors.push(`item XML に identifier がありません: ${ref.href}`);
      continue;
    }
    if (itemIdentifier !== ref.identifier) {
      errors.push(
        `assessmentTest の identifier と item identifier が一致しません: ${ref.identifier} != ${itemIdentifier}`
      );
      continue;
    }
    resolved.push({ ...ref, resolvedHref });
  }
  return { resolved, errors };
};

const validateResultSequenceIndexes = (
  resultName: string,
  resultRefs: ResultItemRef[],
  itemCount: number
): string[] => {
  const errors: string[] = [];
  const seenSequence = new Set<number>();
  for (const ref of resultRefs) {
    if (!ref.hasSequenceIndex || ref.sequenceIndex === null) {
      errors.push(
        `results の itemResult に sequenceIndex が必要です: ${resultName} (${ref.identifier})`
      );
      continue;
    }
    if (ref.sequenceIndex > itemCount) {
      errors.push(
        `results の sequenceIndex が assessmentTest の設問数を超えています: ${resultName} (${ref.identifier})`
      );
      continue;
    }
    if (seenSequence.has(ref.sequenceIndex)) {
      errors.push(
        `results の sequenceIndex が重複しています: ${resultName} (${ref.sequenceIndex})`
      );
      continue;
    }
    seenSequence.add(ref.sequenceIndex);
  }
  for (let index = 1; index <= itemCount; index += 1) {
    if (!seenSequence.has(index)) {
      errors.push(
        `results に sequenceIndex=${index} の itemResult がありません: ${resultName}`
      );
    }
  }
  return errors;
};

export const validateAssessmentConsistency = (params: {
  assessmentTestPath: string;
  assessmentTestXml: string;
  assessmentFiles: Map<string, string>;
  resultFiles: Array<{ name: string; xml: string }>;
}): {
  isValid: boolean;
  errors: string[];
  itemRefs?: AssessmentItemRefResolved[];
} => {
  const errors: string[] = [];
  const parsed = extractAssessmentItemRefs(params.assessmentTestXml);
  errors.push(...parsed.errors);
  const duplicateIdentifiers = detectDuplicateIdentifiers(parsed.itemRefs);
  if (duplicateIdentifiers.length > 0) {
    errors.push(
      `assessmentTest の identifier が重複しています: ${duplicateIdentifiers.join(", ")}`
    );
  }

  const resolvedRefs = resolveItemRefs(
    params.assessmentTestPath,
    parsed.itemRefs,
    params.assessmentFiles
  );
  errors.push(...resolvedRefs.errors);
  const itemCount = parsed.itemRefs.length;

  for (const resultFile of params.resultFiles) {
    const resultParsed = extractResultItemRefs(resultFile.xml);
    errors.push(
      ...resultParsed.errors.map((msg) => `${msg}: ${resultFile.name}`)
    );
    if (resultParsed.itemRefs.length === 0 || itemCount === 0) continue;
    errors.push(
      ...validateResultSequenceIndexes(
        resultFile.name,
        resultParsed.itemRefs,
        itemCount
      )
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    itemRefs: errors.length === 0 ? resolvedRefs.resolved : undefined,
  };
};
