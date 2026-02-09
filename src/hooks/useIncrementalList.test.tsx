import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, Root } from 'react-dom/client'
import { useIncrementalList } from '@/hooks/useIncrementalList'

describe('useIncrementalList', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.useFakeTimers()
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.useRealTimers()
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT
  })

  const TestComponent = ({
    items,
    batchSize = 2,
    delayMs = 5,
  }: {
    items: number[]
    batchSize?: number
    delayMs?: number
  }) => {
    const { visibleItems, isComplete } = useIncrementalList(items, { batchSize, delayMs })
    return (
      <div>
        <div data-testid="count">{visibleItems.length}</div>
        <div data-testid="complete">{isComplete ? 'yes' : 'no'}</div>
      </div>
    )
  }

  it('reveals items in batches over time', () => {
    act(() => {
      root.render(<TestComponent items={[1, 2, 3, 4, 5]} batchSize={2} delayMs={10} />)
    })

    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe('2')
    expect(container.querySelector('[data-testid="complete"]')?.textContent).toBe('no')

    act(() => {
      vi.advanceTimersByTime(10)
    })

    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe('4')

    act(() => {
      vi.advanceTimersByTime(10)
    })

    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe('5')
    expect(container.querySelector('[data-testid="complete"]')?.textContent).toBe('yes')
  })

  it('resets when items change', () => {
    act(() => {
      root.render(<TestComponent items={[1, 2, 3]} batchSize={2} delayMs={10} />)
    })

    act(() => {
      root.render(<TestComponent items={[10, 11, 12, 13]} batchSize={2} delayMs={10} />)
    })

    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe('2')
    expect(container.querySelector('[data-testid="complete"]')?.textContent).toBe('no')
  })
})
