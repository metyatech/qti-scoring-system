import fs from 'fs'
import path from 'path'
import JSZip from 'jszip'

type ReportZipParams = {
  reportDir: string
  results: Array<{ path: string; name: string }>
}

const addDirToZip = (zip: JSZip, sourceDir: string, zipPrefix: string) => {
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(sourceDir, entry.name)
    const targetPath = path.posix.join(zipPrefix, entry.name)
    if (entry.isDirectory()) {
      addDirToZip(zip, entryPath, targetPath)
      continue
    }
    if (entry.isFile()) {
      const content = fs.readFileSync(entryPath)
      zip.file(targetPath, content)
    }
  }
}

export const createReportZip = async (params: ReportZipParams): Promise<Buffer> => {
  const zip = new JSZip()
  addDirToZip(zip, params.reportDir, 'report')

  for (const result of params.results) {
    const content = fs.readFileSync(result.path)
    zip.file(path.posix.join('results', result.name), content)
  }

  return await zip.generateAsync({ type: 'nodebuffer' })
}
