import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scheduleHighlightCodeBlocks } from '@/utils/highlight'

describe('scheduleHighlightCodeBlocks', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  const createBlocks = (count: number) => {
    const root = document.createElement('div')
    for (let i = 0; i < count; i += 1) {
      const pre = document.createElement('pre')
      const code = document.createElement('code')
      code.textContent = `const value${i} = ${i};`
      pre.appendChild(code)
      root.appendChild(pre)
    }
    document.body.appendChild(root)
    return root
  }

  const countHighlighted = (root: ParentNode) =>
    Array.from(root.querySelectorAll('pre code')).filter(
      (block) => (block as HTMLElement).dataset.hljs === '1',
    ).length

  it('highlights blocks in batches', () => {
    const root = createBlocks(5)
    scheduleHighlightCodeBlocks(root, { batchSize: 2 })

    expect(countHighlighted(root)).toBe(0)

    vi.runOnlyPendingTimers()
    expect(countHighlighted(root)).toBe(2)

    vi.runOnlyPendingTimers()
    expect(countHighlighted(root)).toBe(4)

    vi.runOnlyPendingTimers()
    expect(countHighlighted(root)).toBe(5)
  })

  it('cancels pending work', () => {
    const root = createBlocks(4)
    const handle = scheduleHighlightCodeBlocks(root, { batchSize: 2 })
    handle.cancel()

    vi.runOnlyPendingTimers()
    expect(countHighlighted(root)).toBe(0)
  })
})
