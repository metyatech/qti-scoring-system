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

const parseCandidateExplanation = (itemBody: Element): string | null => {
  const rubricBlocks = getElementsByLocalName(itemBody, 'qti-rubric-block');
  const candidate = rubricBlocks.find((block) => block.getAttribute('view') === 'candidate');
  if (!candidate) return null;
  const parts = getElementsByLocalName(candidate, 'qti-p').map((p) => renderNode(p));
  return parts.join('');
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
  switch (name) {
    case 'qti-p':
      return `<p>${Array.from(el.childNodes).map((child) => renderNode(child, blankCounter)).join('')}</p>`;
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
      return Array.from(el.childNodes).map((child) => renderNode(child, blankCounter)).join('');
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
  const candidateExplanationHtml = parseCandidateExplanation(itemBody);

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
