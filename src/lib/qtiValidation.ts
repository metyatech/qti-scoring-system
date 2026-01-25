import { parseMappingCsv } from '@/utils/qtiParsing';

const matchAttribute = (tag: string, attr: string, xml: string): string | null => {
  const re = new RegExp(`<\\s*${tag}\\b[^>]*\\b${attr}\\s*=\\s*(['"])(.*?)\\1`, 'i');
  const match = xml.match(re);
  return match ? match[2] : null;
};

export const extractItemIdentifier = (xml: string): string | null =>
  matchAttribute('qti-assessment-item', 'identifier', xml);

export const extractResultItemIdentifiers = (xml: string): string[] => {
  const ids: string[] = [];
  const re = /<\s*itemResult\b[^>]*\bidentifier\s*=\s*(['"])(.*?)\1/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    ids.push(match[2]);
  }
  return ids;
};

export const validateMappingConsistency = (
  itemXmls: string[],
  resultXmls: string[],
  mappingCsv: string
): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];
  const itemIds = itemXmls.map(extractItemIdentifier).filter((id): id is string => Boolean(id));
  const missingItemIds = itemXmls.length - itemIds.length;
  if (missingItemIds > 0) {
    errors.push('item XML に identifier がないファイルがあります');
  }
  const itemIdSet = new Set(itemIds);
  if (itemIdSet.size !== itemIds.length) {
    errors.push('item XML の identifier が重複しています');
  }

  const resultIds = resultXmls.flatMap(extractResultItemIdentifiers);
  if (resultIds.length === 0) {
    errors.push('results XML から itemResult identifier が取得できません');
  }
  const resultIdSet = new Set(resultIds);

  let mapping: ReturnType<typeof parseMappingCsv>;
  try {
    mapping = parseMappingCsv(mappingCsv);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : 'マッピングCSVの解析に失敗しました');
    return { isValid: false, errors };
  }

  const unknownResultIds = Array.from(mapping.resultToItem.keys()).filter((id) => !resultIdSet.has(id));
  if (unknownResultIds.length > 0) {
    errors.push(`results に存在しない resultItemIdentifier: ${unknownResultIds.join(', ')}`);
  }

  const unknownItemIds = Array.from(mapping.resultToItem.values()).filter((id) => !itemIdSet.has(id));
  if (unknownItemIds.length > 0) {
    errors.push(`items に存在しない itemIdentifier: ${unknownItemIds.join(', ')}`);
  }

  const missingMappings = Array.from(resultIdSet).filter((id) => !mapping.resultToItem.has(id));
  if (missingMappings.length > 0) {
    errors.push(`マッピング未定義の結果ID: ${missingMappings.join(', ')}`);
  }

  return { isValid: errors.length === 0, errors };
};
