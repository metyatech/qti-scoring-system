import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { parseQtiItemXml } from '@/utils/qtiParsing'

const loadGlobalCss = () => {
  const cssPath = path.resolve(process.cwd(), 'src/app/globals.css')
  const cssText = fs.readFileSync(cssPath, 'utf-8')
  const style = document.createElement('style')
  style.textContent = cssText
  document.head.appendChild(style)
  return style
}

describe('cloze blank layout styles', () => {
  it('keeps blanks inline without forced line breaks', () => {
    const style = loadGlobalCss()
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="item-layout" title="Layout" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
  <qti-item-body>
    <qti-p>A<qti-text-entry-interaction response-identifier="RESPONSE"/>B</qti-p>
  </qti-item-body>
</qti-assessment-item>`
    const item = parseQtiItemXml(xml)

    const container = document.createElement('div')
    container.className = 'qti-prompt'
    container.innerHTML = item.promptHtml
    document.body.appendChild(container)

    const input = container.querySelector('input.qti-blank-input')
    expect(input).not.toBeNull()
    expect(container.innerHTML).not.toContain('<br')

    const computed = getComputedStyle(input as HTMLInputElement)
    expect(computed.display).toBe('inline-block')
    expect(computed.minWidth).toBe('6ch')
    expect(computed.color).toBe('rgb(15, 23, 42)')
    expect(Number(computed.fontWeight)).toBeGreaterThanOrEqual(600)

    container.remove()
    style.remove()
  })
})
