import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'

import { resolveTsxCliPath } from './qtiTools'

describe('resolveTsxCliPath', () => {
  it('resolves tsx CLI from the workspace node_modules', () => {
    const cliPath = resolveTsxCliPath(process.cwd())
    expect(cliPath).toContain(path.join('node_modules', 'tsx'))
    expect(fs.existsSync(cliPath)).toBe(true)
  })

  it('falls back to local node_modules when module resolution fails', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qti-tools-'))
    const tsxRoot = path.join(tempRoot, 'node_modules', 'tsx')
    try {
      fs.mkdirSync(path.join(tsxRoot, 'dist'), { recursive: true })
      const pkgPath = path.join(tsxRoot, 'package.json')
      fs.writeFileSync(pkgPath, JSON.stringify({ bin: './dist/cli.mjs' }), 'utf-8')
      fs.writeFileSync(path.join(tsxRoot, 'dist', 'cli.mjs'), '', 'utf-8')

      const cliPath = resolveTsxCliPath(tempRoot)
      expect(cliPath).toBe(path.join(tsxRoot, 'dist', 'cli.mjs'))
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })
})
