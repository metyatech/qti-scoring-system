import { describe, expect, it } from 'vitest'
import { extractItemIdentifier, validateAssessmentConsistency } from '@/lib/qtiValidation'

const makeItemXml = (identifier: string) => `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="${identifier}" />`

const makeAssessmentTestXml = (
  refs: Array<{ identifier: string; href: string }>,
) => `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-test xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="assessment-test" title="Assessment Test">
  <qti-test-part identifier="part-1" navigation-mode="linear" submission-mode="individual">
    <qti-assessment-section identifier="section-1" title="Section 1" visible="true">
      ${refs
        .map(
          (ref) => `<qti-assessment-item-ref identifier="${ref.identifier}" href="${ref.href}" />`,
        )
        .join('\n      ')}
    </qti-assessment-section>
  </qti-test-part>
</qti-assessment-test>`

const makeResultsXml = (
  items: Array<{ identifier: string; sequenceIndex?: number }>,
) => `<?xml version="1.0" encoding="UTF-8"?>
<assessmentResult xmlns="http://www.imsglobal.org/xsd/imsqti_result_v3p0">
  <context sourcedId="candidate-1" />
  ${items
    .map((item) => {
      const sequenceAttr =
        item.sequenceIndex !== undefined ? ` sequenceIndex="${item.sequenceIndex}"` : ''
      return `<itemResult identifier="${item.identifier}"${sequenceAttr} sessionStatus="final" />`
    })
    .join('\n  ')}
</assessmentResult>`

describe('extractItemIdentifier', () => {
  it('extracts identifier with namespace prefix', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<qti:qti-assessment-item xmlns:qti="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="item-1" />`
    expect(extractItemIdentifier(xml)).toBe('item-1')
  })
})

describe('validateAssessmentConsistency', () => {
  it('passes valid assessmentTest, items, and results', () => {
    const assessmentTestPath = 'qti/assessment-test.qti.xml'
    const assessmentTestXml = makeAssessmentTestXml([
      { identifier: 'item-1', href: 'items/item-1.qti.xml' },
      { identifier: 'item-2', href: 'items/item-2.qti.xml' },
    ])
    const assessmentFiles = new Map<string, string>([
      [assessmentTestPath, assessmentTestXml],
      ['qti/items/item-1.qti.xml', makeItemXml('item-1')],
      ['qti/items/item-2.qti.xml', makeItemXml('item-2')],
    ])
    const resultFiles = [
      {
        name: 'assessmentResult-1.xml',
        xml: makeResultsXml([
          { identifier: 'Q1', sequenceIndex: 1 },
          { identifier: 'Q2', sequenceIndex: 2 },
        ]),
      },
    ]

    const validation = validateAssessmentConsistency({
      assessmentTestPath,
      assessmentTestXml,
      assessmentFiles,
      resultFiles,
    })

    expect(validation.isValid).toBe(true)
    expect(validation.itemRefs?.map((ref) => ref.resolvedHref)).toEqual([
      'qti/items/item-1.qti.xml',
      'qti/items/item-2.qti.xml',
    ])
  })

  it('resolves by basename when directory paths are not provided', () => {
    const assessmentTestPath = 'assessment-test.qti.xml'
    const assessmentTestXml = makeAssessmentTestXml([
      { identifier: 'item-1', href: 'items/item-1.qti.xml' },
    ])
    const assessmentFiles = new Map<string, string>([
      [assessmentTestPath, assessmentTestXml],
      ['item-1.qti.xml', makeItemXml('item-1')],
    ])
    const resultFiles = [
      {
        name: 'assessmentResult-1.xml',
        xml: makeResultsXml([{ identifier: 'Q1', sequenceIndex: 1 }]),
      },
    ]

    const validation = validateAssessmentConsistency({
      assessmentTestPath,
      assessmentTestXml,
      assessmentFiles,
      resultFiles,
    })

    expect(validation.isValid).toBe(true)
    expect(validation.itemRefs?.map((ref) => ref.resolvedHref)).toEqual(['item-1.qti.xml'])
  })

  it('fails when basename resolution is ambiguous', () => {
    const assessmentTestPath = 'assessment-test.qti.xml'
    const assessmentTestXml = makeAssessmentTestXml([
      { identifier: 'item-1', href: 'items/item-1.qti.xml' },
    ])
    const assessmentFiles = new Map<string, string>([
      [assessmentTestPath, assessmentTestXml],
      ['a/item-1.qti.xml', makeItemXml('item-1')],
      ['b/item-1.qti.xml', makeItemXml('item-1')],
    ])
    const resultFiles = [
      {
        name: 'assessmentResult-1.xml',
        xml: makeResultsXml([{ identifier: 'Q1', sequenceIndex: 1 }]),
      },
    ]

    const validation = validateAssessmentConsistency({
      assessmentTestPath,
      assessmentTestXml,
      assessmentFiles,
      resultFiles,
    })

    expect(validation.isValid).toBe(false)
    expect(validation.errors.join('\n')).toContain('一意に特定できません')
  })

  it('fails when assessmentTest references a missing item file', () => {
    const assessmentTestPath = 'assessment-test.qti.xml'
    const assessmentTestXml = makeAssessmentTestXml([
      { identifier: 'item-1', href: 'item-1.qti.xml' },
    ])
    const assessmentFiles = new Map<string, string>([[assessmentTestPath, assessmentTestXml]])
    const resultFiles = [
      {
        name: 'assessmentResult-1.xml',
        xml: makeResultsXml([{ identifier: 'Q1', sequenceIndex: 1 }]),
      },
    ]

    const validation = validateAssessmentConsistency({
      assessmentTestPath,
      assessmentTestXml,
      assessmentFiles,
      resultFiles,
    })

    expect(validation.isValid).toBe(false)
    expect(validation.errors.join('\n')).toContain('assessmentTest が参照する item がありません')
  })

  it('fails when item identifier does not match assessmentTest identifier', () => {
    const assessmentTestPath = 'assessment-test.qti.xml'
    const assessmentTestXml = makeAssessmentTestXml([
      { identifier: 'item-1', href: 'item-1.qti.xml' },
    ])
    const assessmentFiles = new Map<string, string>([
      [assessmentTestPath, assessmentTestXml],
      ['item-1.qti.xml', makeItemXml('item-x')],
    ])
    const resultFiles = [
      {
        name: 'assessmentResult-1.xml',
        xml: makeResultsXml([{ identifier: 'Q1', sequenceIndex: 1 }]),
      },
    ]

    const validation = validateAssessmentConsistency({
      assessmentTestPath,
      assessmentTestXml,
      assessmentFiles,
      resultFiles,
    })

    expect(validation.isValid).toBe(false)
    expect(validation.errors.join('\n')).toContain(
      'assessmentTest の identifier と item identifier が一致しません',
    )
  })

  it('fails when results are missing sequenceIndex', () => {
    const assessmentTestPath = 'assessment-test.qti.xml'
    const assessmentTestXml = makeAssessmentTestXml([
      { identifier: 'item-1', href: 'item-1.qti.xml' },
    ])
    const assessmentFiles = new Map<string, string>([
      [assessmentTestPath, assessmentTestXml],
      ['item-1.qti.xml', makeItemXml('item-1')],
    ])
    const resultFiles = [
      { name: 'assessmentResult-1.xml', xml: makeResultsXml([{ identifier: 'Q1' }]) },
    ]

    const validation = validateAssessmentConsistency({
      assessmentTestPath,
      assessmentTestXml,
      assessmentFiles,
      resultFiles,
    })

    expect(validation.isValid).toBe(false)
    expect(validation.errors.join('\n')).toContain('sequenceIndex が必要です')
  })

  it('fails when sequenceIndex exceeds assessmentTest item count', () => {
    const assessmentTestPath = 'assessment-test.qti.xml'
    const assessmentTestXml = makeAssessmentTestXml([
      { identifier: 'item-1', href: 'item-1.qti.xml' },
      { identifier: 'item-2', href: 'item-2.qti.xml' },
    ])
    const assessmentFiles = new Map<string, string>([
      [assessmentTestPath, assessmentTestXml],
      ['item-1.qti.xml', makeItemXml('item-1')],
      ['item-2.qti.xml', makeItemXml('item-2')],
    ])
    const resultFiles = [
      {
        name: 'assessmentResult-1.xml',
        xml: makeResultsXml([
          { identifier: 'Q1', sequenceIndex: 1 },
          { identifier: 'Q3', sequenceIndex: 3 },
        ]),
      },
    ]

    const validation = validateAssessmentConsistency({
      assessmentTestPath,
      assessmentTestXml,
      assessmentFiles,
      resultFiles,
    })

    expect(validation.isValid).toBe(false)
    expect(validation.errors.join('\n')).toContain('設問数を超えています')
  })

  it('fails on duplicate sequenceIndex in results', () => {
    const assessmentTestPath = 'assessment-test.qti.xml'
    const assessmentTestXml = makeAssessmentTestXml([
      { identifier: 'item-1', href: 'item-1.qti.xml' },
      { identifier: 'item-2', href: 'item-2.qti.xml' },
    ])
    const assessmentFiles = new Map<string, string>([
      [assessmentTestPath, assessmentTestXml],
      ['item-1.qti.xml', makeItemXml('item-1')],
      ['item-2.qti.xml', makeItemXml('item-2')],
    ])
    const resultFiles = [
      {
        name: 'assessmentResult-1.xml',
        xml: makeResultsXml([
          { identifier: 'Q1', sequenceIndex: 1 },
          { identifier: 'Q2', sequenceIndex: 1 },
        ]),
      },
    ]

    const validation = validateAssessmentConsistency({
      assessmentTestPath,
      assessmentTestXml,
      assessmentFiles,
      resultFiles,
    })

    expect(validation.isValid).toBe(false)
    expect(validation.errors.join('\n')).toContain('sequenceIndex が重複しています')
  })

  it('fails when a sequenceIndex is missing in results', () => {
    const assessmentTestPath = 'assessment-test.qti.xml'
    const assessmentTestXml = makeAssessmentTestXml([
      { identifier: 'item-1', href: 'item-1.qti.xml' },
      { identifier: 'item-2', href: 'item-2.qti.xml' },
    ])
    const assessmentFiles = new Map<string, string>([
      [assessmentTestPath, assessmentTestXml],
      ['item-1.qti.xml', makeItemXml('item-1')],
      ['item-2.qti.xml', makeItemXml('item-2')],
    ])
    const resultFiles = [
      {
        name: 'assessmentResult-1.xml',
        xml: makeResultsXml([{ identifier: 'Q1', sequenceIndex: 1 }]),
      },
    ]

    const validation = validateAssessmentConsistency({
      assessmentTestPath,
      assessmentTestXml,
      assessmentFiles,
      resultFiles,
    })

    expect(validation.isValid).toBe(false)
    expect(validation.errors.join('\n')).toContain('sequenceIndex=2 の itemResult がありません')
  })
})
