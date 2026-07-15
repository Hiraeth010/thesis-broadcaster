import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'

// MV3 fails silently on a bad path: Chrome just doesn't run the thing. Cheap to
// check, expensive to miss.

const root = resolve('extension')
let pass = 0
let fail = 0
const check = (n, c, d = '') => {
  if (c) { pass++; console.log(`  PASS  ${n}`) } else { fail++; console.log(`  FAIL  ${n} ${d}`) }
}

console.log('\nExtension manifest and module graph\n')

const m = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'))
check('manifest v3', m.manifest_version === 3)
check('service worker is an ES module', m.background?.type === 'module')

const refs = [
  m.background.service_worker,
  ...m.content_scripts.flatMap((c) => c.js),
  m.action.default_popup,
  m.options_ui.page,
]
for (const r of refs) check(`referenced file exists: ${r}`, existsSync(resolve(root, r)))

// The page-world hook cannot reach chrome.runtime, and the isolated-world relay
// cannot hook the page's fetch — so both worlds must be present.
const worlds = m.content_scripts.map((c) => c.world)
check('a MAIN-world script exists (to hook fetch)', worlds.includes('MAIN'))
check('an ISOLATED-world script exists (to reach chrome.runtime)', worlds.includes('ISOLATED'))

for (const host of ['https://api.telegram.org/*', 'https://discord.com/*', 'https://api.twitter.com/*']) {
  check(`host permission present: ${host}`, m.host_permissions.includes(host))
}
check('alarms permission (polling depends on it)', m.permissions.includes('alarms'))
check('storage permission (all state depends on it)', m.permissions.includes('storage'))

const seen = new Set()
function walk(file) {
  if (seen.has(file)) return
  seen.add(file)
  if (!existsSync(file)) {
    check(`import resolves: ${relative(root, file)}`, false)
    return
  }
  const src = readFileSync(file, 'utf8')
  for (const im of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) walk(resolve(dirname(file), im[1]))
}
for (const entry of ['background.js', 'options.js', 'popup.js']) walk(resolve(root, entry))
check(`all ${seen.size} modules in the graph resolve`, true)

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
