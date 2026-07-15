import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Replaced with `true` by esbuild when building the standalone binary. In a
// normal `node src/server.js` run it is simply undeclared, so typeof guards it.
// eslint-disable-next-line no-undef
export const packaged = typeof __SEA_BUILD__ !== 'undefined' && __SEA_BUILD__

// Packaged: everything lives beside the .exe the user double-clicked.
// Source: one level up from src/.
export const appRoot = packaged
  ? dirname(process.execPath)
  : join(dirname(fileURLToPath(import.meta.url)), '..')

export const dataDir = join(appRoot, 'data')
export const publicDir = join(appRoot, 'src', 'public')
