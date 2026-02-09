import fs from 'fs'
import os from 'os'
import path from 'path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { createReportZip } from './reportZip'

describe('createReportZip', () => {
  it('packages report outputs and result XML files', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'report-zip-'))
    try {
      const reportDir = path.join(root, 'report')
      const resultsDir = path.join(root, 'results')
      fs.mkdirSync(path.join(reportDir, 'user-1'), { recursive: true })
      fs.mkdirSync(resultsDir, { recursive: true })

      fs.writeFileSync(path.join(reportDir, 'report.csv'), 'header\nrow', 'utf-8')
      fs.writeFileSync(path.join(reportDir, 'user-1', 'result.html'), '<html></html>', 'utf-8')
      const resultPath = path.join(resultsDir, 'assessmentResult-1.xml')
      fs.writeFileSync(resultPath, '<assessmentResult />', 'utf-8')

      const buffer = await createReportZip({
        reportDir,
        results: [{ path: resultPath, name: 'assessmentResult-1.xml' }],
      })

      const zip = await JSZip.loadAsync(buffer)
      const entries = Object.keys(zip.files)
      expect(entries).toContain('report/report.csv')
      expect(entries).toContain('report/user-1/result.html')
      expect(entries).toContain('results/assessmentResult-1.xml')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
