import { describe, expect, it } from 'vitest'
import { autoResizeTextarea } from '@/utils/textarea'

describe('autoResizeTextarea', () => {
  it('sets height to scrollHeight', () => {
    const el = document.createElement('textarea')
    Object.defineProperty(el, 'scrollHeight', { value: 120, configurable: true })
    autoResizeTextarea(el)
    expect(el.style.height).toBe('120px')
  })

  it('resets height before measuring', () => {
    const el = document.createElement('textarea')
    el.style.height = '300px'
    Object.defineProperty(el, 'scrollHeight', { value: 80, configurable: true })
    autoResizeTextarea(el)
    expect(el.style.height).toBe('80px')
  })
})
