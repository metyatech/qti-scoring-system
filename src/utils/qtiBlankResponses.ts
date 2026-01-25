const MIN_BLANK_SIZE = 6;

const normalizeResponses = (response: string | string[] | null | undefined): string[] => {
  if (response === null || response === undefined) return [];
  return Array.isArray(response) ? response : [response];
};

const computeBlankSize = (value: string): number => {
  return Math.max(MIN_BLANK_SIZE, value.length);
};

export const applyResponsesToPromptHtml = (
  promptHtml: string,
  response: string | string[] | null | undefined
): string => {
  if (!promptHtml.includes('qti-blank-input')) {
    return promptHtml;
  }

  const responses = normalizeResponses(response);
  if (responses.length === 0) {
    return promptHtml;
  }

  const doc = new DOMParser().parseFromString(promptHtml, 'text/html');
  const blanks = Array.from(doc.querySelectorAll<HTMLInputElement>('input.qti-blank-input'));
  if (blanks.length === 0) {
    return promptHtml;
  }

  blanks.forEach((blank, index) => {
    const value = responses[index];
    if (value === undefined) return;
    blank.setAttribute('value', value);
    blank.setAttribute('size', String(computeBlankSize(value)));
  });

  return doc.body.innerHTML;
};

