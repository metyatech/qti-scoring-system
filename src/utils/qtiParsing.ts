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

export interface AssessmentItemRef {
  identifier: string;
  href: string;
}

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

const renderNode = (node: Node, blankCounter?: { value: number }): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeHtml(node.textContent ?? '');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }
  const el = node as Element;
  const name = el.localName;
  const renderChildren = () =>
    Array.from(el.childNodes).map((child) => renderNode(child, blankCounter)).join('');
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
      return `<code>${renderChildren()}</code>`;
    case 'qti-pre':
      return `<pre>${renderChildren()}</pre>`;
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
      return `<span class="qti-blank" data-blank="${idx}"></span>`;
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

const parsePositiveInteger = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return undefined;
  return parsed;
};

export const parseQtiResultsXml = (xml: string, fileName: string): QtiResult => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (root.nodeName === 'parsererror') {
    throw new Error('QTI Results XML の解析に失敗しました');
  }
  const context = getElementsByLocalName(root, 'context')[0];
  const sourcedId = context?.getAttribute('sourcedId') ?? '';
  let candidateName = sourcedId || fileName;
  if (context) {
    const sessionIdentifiers = getElementsByLocalName(context, 'sessionIdentifier');
    const candidateNameNode = sessionIdentifiers.find((node) => node.getAttribute('sourceID') === 'candidateName');
    if (candidateNameNode) {
      candidateName = candidateNameNode.getAttribute('identifier') ?? candidateName;
    }
  }

  const itemResults: Record<string, QtiItemResult> = {};
  const itemResultNodes = getElementsByLocalName(root, 'itemResult');
  for (const itemResult of itemResultNodes) {
    const resultIdentifier = itemResult.getAttribute('identifier') ?? '';
    const sequenceIndex = parsePositiveInteger(itemResult.getAttribute('sequenceIndex'));
    const responseVariable = getElementsByLocalName(itemResult, 'responseVariable')
      .find((rv) => rv.getAttribute('identifier') === 'RESPONSE');
    let response: string | string[] | null = null;
    if (responseVariable) {
      const candidateResponse = getElementsByLocalName(responseVariable, 'candidateResponse')[0];
      if (candidateResponse) {
        const values = getElementsByLocalName(candidateResponse, 'value').map((v) => v.textContent ?? '');
        if (values.length === 1) response = values[0];
        else if (values.length > 1) response = values;
      }
    }

    const outcomeVars = getElementsByLocalName(itemResult, 'outcomeVariable');
    const scoreVar = outcomeVars.find((ov) => ov.getAttribute('identifier') === 'SCORE');
    const scoreValue = scoreVar ? getElementsByLocalName(scoreVar, 'value')[0]?.textContent : undefined;
    const commentVar = outcomeVars.find((ov) => ov.getAttribute('identifier') === 'COMMENT');
    const commentValue = commentVar ? getElementsByLocalName(commentVar, 'value')[0]?.textContent : undefined;

    const rubricOutcomes: Record<number, boolean> = {};
    for (const ov of outcomeVars) {
      const id = ov.getAttribute('identifier') ?? '';
      const match = id.match(/^RUBRIC_(\d+)_MET$/);
      if (!match) continue;
      const idx = Number(match[1]);
      const value = getElementsByLocalName(ov, 'value')[0]?.textContent;
      if (value === 'true') rubricOutcomes[idx] = true;
      if (value === 'false') rubricOutcomes[idx] = false;
    }

    itemResults[resultIdentifier] = {
      resultIdentifier,
      sequenceIndex,
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
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (root.nodeName === 'parsererror') {
    throw new Error('assessmentTest XML の解析に失敗しました');
  }
  if (root.localName !== 'qti-assessment-test') {
    throw new Error('assessmentTest のルート要素が不正です');
  }
  const refNodes = getElementsByLocalName(root, 'qti-assessment-item-ref');
  const itemRefs = refNodes.map((node) => {
    const identifier = node.getAttribute('identifier') ?? '';
    const href = node.getAttribute('href') ?? '';
    return { identifier, href };
  });
  if (itemRefs.length === 0) {
    throw new Error('assessmentTest に itemRef がありません');
  }
  const missing = itemRefs.filter((ref) => !ref.identifier || !ref.href);
  if (missing.length > 0) {
    throw new Error('assessmentTest の itemRef に identifier / href がありません');
  }
  return itemRefs;
};

const normalizeRelativePath = (value: string): string => {
  const parts = value.replace(/\\/g, '/').split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      throw new Error(`不正な相対パスです: ${value}`);
    }
    stack.push(part);
  }
  return stack.join('/');
};

export const resolveAssessmentHref = (assessmentTestPath: string, href: string): string => {
  const testPath = normalizeRelativePath(assessmentTestPath);
  const baseDirParts = testPath.split('/');
  baseDirParts.pop();
  const baseDir = baseDirParts.join('/');
  const combined = baseDir ? `${baseDir}/${href}` : href;
  return normalizeRelativePath(combined);
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
