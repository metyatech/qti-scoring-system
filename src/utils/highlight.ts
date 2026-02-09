import hljs from 'highlight.js/lib/common'

const resolveLanguage = (el: HTMLElement) => {
  const match = Array.from(el.classList).find(
    (cls) => cls.startsWith('language-') || cls.startsWith('lang-'),
  )
  if (!match) return null
  const language = match.split('-', 2)[1]?.trim().toLowerCase()
  if (!language) return null
  return hljs.getLanguage(language) ? language : null
}

const looksLikeMarkup = (source: string) => /<\/?[A-Za-z][^>]*>/.test(source)

const highlightCodeBlock = (el: HTMLElement) => {
  if (el.dataset.hljs === '1' || el.dataset.hljs === 'skip') return false
  if (el.querySelector('.qti-blank, .qti-blank-input')) {
    el.dataset.hljs = 'skip'
    return false
  }
  const language = resolveLanguage(el)
  const source = el.textContent ?? ''
  const fallbackLanguage = !language && looksLikeMarkup(source) ? 'xml' : null
  const appliedLanguage = language || fallbackLanguage
  const result = language
    ? hljs.highlight(source, { language, ignoreIllegals: true })
    : fallbackLanguage
      ? hljs.highlight(source, { language: fallbackLanguage, ignoreIllegals: true })
      : hljs.highlightAuto(source)
  el.innerHTML = result.value
  el.classList.add('hljs')
  const resolvedLanguage = appliedLanguage || result.language
  if (resolvedLanguage) {
    el.classList.add(`language-${resolvedLanguage}`)
  }
  el.dataset.hljs = '1'
  return true
}

export const highlightCodeBlocks = (root: ParentNode) => {
  const blocks = root.querySelectorAll('pre code')
  blocks.forEach((block) => {
    highlightCodeBlock(block as HTMLElement)
  })
  return blocks.length
}

type HighlightSchedulerOptions = {
  batchSize?: number
  delayMs?: number
}

export type HighlightScheduleHandle = {
  cancel: () => void
}

export const scheduleHighlightCodeBlocks = (
  root: ParentNode,
  options: HighlightSchedulerOptions = {},
): HighlightScheduleHandle => {
  const batchSize = options.batchSize ?? 24
  const delayMs = options.delayMs ?? 0
  const blocks = Array.from(root.querySelectorAll('pre code')) as HTMLElement[]
  let cancelled = false
  let index = 0
  let timer: number | null = null

  const runBatch = () => {
    if (cancelled) return
    const end = Math.min(index + batchSize, blocks.length)
    for (let i = index; i < end; i += 1) {
      highlightCodeBlock(blocks[i])
    }
    index = end
    if (index < blocks.length && !cancelled) {
      timer = window.setTimeout(runBatch, delayMs)
    }
  }

  timer = window.setTimeout(runBatch, delayMs)

  return {
    cancel: () => {
      cancelled = true
      if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
    },
  }
}
