import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Builds a standalone executable with Node's Single Executable Application
// support. Note: SEA cannot cross-compile — this produces a binary for the
// platform it runs on. Other platforms are built by CI (.github/workflows).

const root = process.cwd()
const build = join(root, 'build')
const isWin = process.platform === 'win32'
const exeName = isWin ? 'thesis-broadcaster.exe' : 'thesis-broadcaster'
const outExe = join(build, exeName)

// npx needs a shell on Windows; process.execPath must NOT go through one — its
// path contains spaces ("C:\Program Files\nodejs") and the shell splits it.
const run = (cmd, args, { shell = false } = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', shell, cwd: root })

const runNpx = (args) => run('npx', args, { shell: isWin })

console.log('\n[1/4] bundling to a single CJS file')
rmSync(build, { recursive: true, force: true })
mkdirSync(build, { recursive: true })
runNpx([
  'esbuild',
  'src/server.js',
  '--bundle',
  '--platform=node',
  '--target=node20',
  '--format=cjs',
  '--define:__SEA_BUILD__=true',
  '--log-override:empty-import-meta=silent',
  `--outfile=${join(build, 'app.cjs')}`,
])

console.log('\n[2/4] writing sea-config')
writeFileSync(
  join(build, 'sea-config.json'),
  JSON.stringify(
    {
      main: 'build/app.cjs',
      output: 'build/sea-prep.blob',
      disableExperimentalSEAWarning: true,
      // The dashboard has no file on disk in a packaged build.
      assets: { 'index.html': 'src/public/index.html' },
    },
    null,
    2
  )
)

console.log('\n[3/4] generating the SEA blob')
run(process.execPath, ['--experimental-sea-config', 'build/sea-config.json'])

console.log('\n[4/4] injecting into a copy of node')
copyFileSync(process.execPath, outExe)
const postjectArgs = [
  'postject',
  outExe,
  'NODE_SEA_BLOB',
  'build/sea-prep.blob',
  '--sentinel-fuse',
  'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
]
if (process.platform === 'darwin') postjectArgs.push('--macho-segment-name', 'NODE_SEA')
runNpx(postjectArgs)

const mb = (statSync(outExe).size / 1e6).toFixed(0)
console.log(`\ndone -> build/${exeName}  (${mb} MB)`)
console.log('ship it next to a data/ folder; config is written beside the exe.\n')
