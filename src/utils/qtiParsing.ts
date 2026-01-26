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

import {
  parseAssessmentTestXml as parseAssessmentTestXmlCore,
  parseResultsXmlRaw,
  resolveAssessmentHref as resolveAssessmentHrefCore,
  type AssessmentItemRef,
} from 'qti-xml-core';

export interface RemapResult {
  mappedItemResults: Record<string, QtiItemResult>;
  missingResultIdentifiers: string[];
  duplicateItemIdentifiers: string[];
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const getElementsByLocalName = (root: Element, localName: string) => {
  const withNamespace = Array.from(root.getElementsByTagNameNS('*', localName));
  if (withNamespace.length > 0) return withNamespace;
  return Array.from(root.getElementsByTagName(localName));
};

const parseRubric = (itemBody: Element): QtiRubricCriterion[] => {
  const rubricBlocks = getElementsByLocalName(itemBody, 'qti-rubric-block');
  const scorer = rubricBlocks.find((block) => block.getAttribute('view') === 'scorer');
  if (!scorer) return [];
  const lines = getElementsByLocalName(scorer, 'qti-p');
  const criteria: QtiRubricCriterion[] = [];
  for (const line of lines) {
    const text = line.textContent?.trim() ?? '';
    const match = text.match(/^\[([\d.]+)\]\s+(.+)$/);
    if (!match) continue;
    criteria.push({
      index: criteria.length + 1,
      points: Number(match[1]),
      text: match[2].trim(),
    });
  }
  return criteria;
};

const parseCandidateExplanation = (root: Element): string | null => {
  const modalFeedbacks = getElementsByLocalName(root, 'qti-modal-feedback');
  const explanationFeedback =
    modalFeedbacks.find(
      (feedback) =>
        feedback.getAttribute('identifier') === 'EXPLANATION' &&
        feedback.getAttribute('outcome-identifier') === 'FEEDBACK'
    ) ??
    modalFeedbacks.find((feedback) => feedback.getAttribute('identifier') === 'EXPLANATION');
  if (explanationFeedback) {
    const contentBody = getElementsByLocalName(explanationFeedback, 'qti-content-body')[0];
    if (contentBody) {
      const explanationNodes = Array.from(contentBody.childNodes).filter(
        (node) => node.nodeType !== Node.TEXT_NODE || (node.textContent?.trim() ?? '') !== ''
      );
      return explanationNodes
        .map((node) => renderNode(node))
        .join('');
    }
  }
  return null;
};

const renderNode = (
  node: Node,
  blankCounter?: { value: number },
  inPre = false,
  preserveWhitespace = false
): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    if (inPre && !preserveWhitespace && text.trim() === '') {
      return '';
    }
    return escapeHtml(text);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }
  const el = node as Element;
  const name = el.localName;
  const renderChildren = (nextInPre = inPre, nextPreserveWhitespace = preserveWhitespace) =>
    Array.from(el.childNodes)
      .map((child) => renderNode(child, blankCounter, nextInPre, nextPreserveWhitespace))
      .join('');
  switch (name) {
    case 'qti-p':
      return `<p>${renderChildren()}</p>`;
    case 'qti-h3':
    case 'qti-h4':
    case 'qti-h5':
    case 'qti-h6': {
      const level = name.slice(-2);
      return `<${level}>${renderChildren()}</${level}>`;
    }
    case 'qti-em':
      return `<em>${renderChildren()}</em>`;
    case 'qti-strong':
      return `<strong>${renderChildren()}</strong>`;
    case 'qti-del':
      return `<del>${renderChildren()}</del>`;
    case 'qti-a': {
      const href = el.getAttribute('href');
      const title = el.getAttribute('title');
      const hrefAttr = href ? ` href="${escapeHtml(href)}"` : '';
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a${hrefAttr}${titleAttr}>${renderChildren()}</a>`;
    }
    case 'qti-code':
      return `<code>${renderChildren(inPre, true)}</code>`;
    case 'qti-pre': {
      const isBlankInteraction = (child: Node) =>
        child.nodeType === Node.ELEMENT_NODE &&
        (child as Element).localName === 'qti-text-entry-interaction';
      const significantNodes = Array.from(el.childNodes).filter((child) => {
        if (child.nodeType !== Node.TEXT_NODE) return true;
        return (child.textContent ?? '').trim() !== '';
      });
      const renderCodeInPre = (codeEl: Element, trimStart: boolean, trimEnd: boolean) => {
        let inner = Array.from(codeEl.childNodes)
          .map((child) => renderNode(child, blankCounter, true, true))
          .join('');
        if (trimStart) {
          const leading = inner.match(/^\s+/)?.[0] ?? '';
          if (leading && !leading.includes('\n') && !leading.includes('\r')) {
            inner = inner.slice(leading.length);
          }
        }
        if (trimEnd) {
          const trailing = inner.match(/\s+$/)?.[0] ?? '';
          if (trailing && !trailing.includes('\n') && !trailing.includes('\r')) {
            inner = inner.slice(0, inner.length - trailing.length);
          }
        }
        return `<code>${inner}</code>`;
      };
      const hasBlank = significantNodes.some(
        (child) =>
          child.nodeType === Node.ELEMENT_NODE &&
          (child as Element).localName === 'qti-text-entry-interaction'
      );
      const rendered = significantNodes
        .map((child, index) => {
          if (child.nodeType === Node.ELEMENT_NODE && (child as Element).localName === 'qti-code') {
            const prevBlank = index > 0 && isBlankInteraction(significantNodes[index - 1]);
            const nextBlank =
              index < significantNodes.length - 1 && isBlankInteraction(significantNodes[index + 1]);
            return renderCodeInPre(child as Element, prevBlank, nextBlank);
          }
          return renderNode(child, blankCounter, true, false);
        })
        .join('');
      const classAttr = hasBlank ? ' class="qti-pre-with-blanks"' : '';
      return `<pre${classAttr}>${rendered}</pre>`;
    }
    case 'qti-blockquote':
      return `<blockquote>${renderChildren()}</blockquote>`;
    case 'qti-ul':
      return `<ul>${renderChildren()}</ul>`;
    case 'qti-ol': {
      const start = el.getAttribute('start');
      const startAttr = start ? ` start="${escapeHtml(start)}"` : '';
      return `<ol${startAttr}>${renderChildren()}</ol>`;
    }
    case 'qti-li':
      return `<li>${renderChildren()}</li>`;
    case 'qti-table':
      return `<table>${renderChildren()}</table>`;
    case 'qti-thead':
      return `<thead>${renderChildren()}</thead>`;
    case 'qti-tbody':
      return `<tbody>${renderChildren()}</tbody>`;
    case 'qti-tr':
      return `<tr>${renderChildren()}</tr>`;
    case 'qti-th':
      return `<th>${renderChildren()}</th>`;
    case 'qti-td':
      return `<td>${renderChildren()}</td>`;
    case 'qti-hr':
      return '<hr />';
    case 'qti-img': {
      const src = el.getAttribute('src') ?? '';
      const alt = el.getAttribute('alt') ?? '';
      const title = el.getAttribute('title');
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${titleAttr} />`;
    }
    case 'qti-text-entry-interaction': {
      const idx = blankCounter ? ++blankCounter.value : 0;
      return `<input class="qti-blank-input" data-blank="${idx}" type="text" size="6" disabled aria-label="blank ${idx}" />`;
    }
    case 'qti-extended-text-interaction':
      return '<span class="qti-extended-placeholder">（記述）</span>';
    case 'qti-choice-interaction': {
      const choices = getElementsByLocalName(el, 'qti-simple-choice');
      const listItems = choices
        .map((choice) => {
          const id = choice.getAttribute('identifier') ?? '';
          const text = Array.from(choice.childNodes).map((child) => renderNode(child, blankCounter)).join('');
          return `<li data-choice="${escapeHtml(id)}">${text}</li>`;
        })
        .join('');
      return `<ol class="qti-choice-list">${listItems}</ol>`;
    }
    case 'qti-rubric-block':
      return '';
    default:
      return renderChildren();
  }
};

const buildPromptHtml = (itemBody: Element): string => {
  const blankCounter = { value: 0 };
  return Array.from(itemBody.childNodes).map((node) => renderNode(node, blankCounter)).join('');
};

export const parseQtiItemXml = (xml: string): QtiItem => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (root.nodeName === 'parsererror') {
    throw new Error('QTI item XML の解析に失敗しました');
  }
  const identifier = root.getAttribute('identifier') ?? '';
  const title = root.getAttribute('title') ?? identifier;
  const itemBody = getElementsByLocalName(root, 'qti-item-body')[0];
  if (!itemBody) {
    throw new Error('qti-item-body が見つかりません');
  }

  const hasChoice = getElementsByLocalName(itemBody, 'qti-choice-interaction').length > 0;
  const hasCloze = getElementsByLocalName(itemBody, 'qti-text-entry-interaction').length > 0;
  const type: QtiItemType = hasChoice ? 'choice' : hasCloze ? 'cloze' : 'descriptive';
  const promptHtml = buildPromptHtml(itemBody);
  const choices: QtiChoice[] = [];
  if (hasChoice) {
    const choiceNodes = getElementsByLocalName(itemBody, 'qti-simple-choice');
    for (const node of choiceNodes) {
      choices.push({
        identifier: node.getAttribute('identifier') ?? '',
        text: node.textContent?.trim() ?? '',
      });
    }
  }
  const rubric = parseRubric(itemBody);
  const candidateExplanationHtml = parseCandidateExplanation(root);

  return {
    identifier,
    title,
    type,
    promptHtml,
    choices,
    rubric,
    candidateExplanationHtml,
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

export const parseMappingCsv = (csv: string) => {
  const lines = csv.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) {
    throw new Error('マッピングCSVが空です');
  }
  const parseCsvLine = (line: string): string[] => {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        const next = line[i + 1];
        if (inQuotes && next === '"') {
          current += '"';
          i += 1;
          continue;
        }
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === ',' && !inQuotes) {
        fields.push(current);
        current = '';
        continue;
      }
      current += ch;
    }
    fields.push(current);
    return fields;
  };

  const headerLine = lines[0].replace(/^\uFEFF/, '');
  const headerFields = parseCsvLine(headerLine).map((v) => v.trim().replace(/\s+/g, ''));
  if (headerFields[0] !== 'resultItemIdentifier' || headerFields[1] !== 'itemIdentifier') {
    throw new Error('マッピングCSVのヘッダーが不正です');
  }
  const resultToItem = new Map<string, string>();
  const itemToResult = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const parsed = parseCsvLine(line);
    const resultId = (parsed[0] ?? '').trim();
    const itemId = (parsed[1] ?? '').trim();
    if (!resultId || !itemId) continue;
    resultToItem.set(resultId, itemId);
    itemToResult.set(itemId, resultId);
  }
  return { resultToItem, itemToResult };
};
