import hljs from 'highlight.js/lib/common';

const resolveLanguage = (el: HTMLElement) => {
  const match = Array.from(el.classList).find(
    (cls) => cls.startsWith('language-') || cls.startsWith('lang-')
  );
  if (!match) return null;
  const language = match.split('-', 2)[1]?.trim().toLowerCase();
  if (!language) return null;
  return hljs.getLanguage(language) ? language : null;
};

const looksLikeMarkup = (source: string) => /<\/?[A-Za-z][^>]*>/.test(source);

export const highlightCodeBlocks = (root: ParentNode) => {
  const blocks = root.querySelectorAll('pre code');
  blocks.forEach((block) => {
    const el = block as HTMLElement;
    if (el.dataset.hljs === '1' || el.dataset.hljs === 'skip') return;
    if (el.querySelector('.qti-blank, .qti-blank-input')) {
      el.dataset.hljs = 'skip';
      return;
    }
    const language = resolveLanguage(el);
    const source = el.textContent ?? '';
    const fallbackLanguage = !language && looksLikeMarkup(source) ? 'xml' : null;
    const appliedLanguage = language || fallbackLanguage;
    const result = language
      ? hljs.highlight(source, { language, ignoreIllegals: true })
      : fallbackLanguage
      ? hljs.highlight(source, { language: fallbackLanguage, ignoreIllegals: true })
      : hljs.highlightAuto(source);
    el.innerHTML = result.value;
    el.classList.add('hljs');
    const resolvedLanguage = appliedLanguage || result.language;
    if (resolvedLanguage) {
      el.classList.add(`language-${resolvedLanguage}`);
    }
    el.dataset.hljs = '1';
  });
  return blocks.length;
};
