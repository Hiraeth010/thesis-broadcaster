import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const files = readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort()

let failed = 0
for (const f of files) {
  try {
    execFileSync(process.execPath, [join(here, f)], { stdio: 'inherit' })
  } catch {
    failed++
  }
}

console.log(failed ? `\n${failed} suite(s) failed\n` : `\nall ${files.length} suites passed\n`)
process.exit(failed ? 1 : 0)
