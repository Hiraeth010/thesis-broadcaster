import { getSettings, saveSettings } from './settings.js'

// fomo has no public API and its thesis endpoint isn't discoverable from the
// public bundle, so nothing here is hardcoded. The extension forwards the
// requests your own tab already makes, and we learn which one carries a thesis
// — either automatically, or by you pointing at it once.
//
// Nothing is stored beyond the last few candidates, in memory, on your machine.

const MAX_CANDIDATES = 25
const candidates = []

// A thesis is prose: long enough to be a sentence, short enough to be a post,
// and not an address/hash/id.
const MIN_LEN = 12
const MAX_LEN = 2000

function looksLikeProse(v) {
  if (typeof v !== 'string') return false
  if (v.length < MIN_LEN || v.length > MAX_LEN) return false
  if (/^[0-9a-fA-F]{32,}$/.test(v)) return false // hash
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return false // base58 address
  if (/^https?:\/\//.test(v)) return false
  if (!/\s/.test(v)) return false // single token, not a sentence
  return true
}

/** Every string field in an object, with its dotted path. */
function* walk(obj, path = '') {
  if (!obj || typeof obj !== 'object') return
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k
    if (typeof v === 'string') yield [p, v]
    else if (v && typeof v === 'object') yield* walk(v, p)
  }
}

export function getAtPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj)
}

/** Prose fields in a payload, best candidate first. */
function proseFields(body) {
  return [...walk(body)]
    .filter(([, v]) => looksLikeProse(v))
    .sort((a, b) => b[1].length - a[1].length)
}

/** A mint sitting alongside the thesis lets us match it to the right trade. */
function findMint(body) {
  for (const [, v] of walk(body)) {
    if (typeof v === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return v
  }
  return null
}

function urlPattern(url) {
  try {
    const u = new URL(url)
    // Ids in the path would make the pattern too specific to match next time.
    const path = u.pathname.replace(/\/[0-9a-fA-F-]{8,}/g, '/*').replace(/\/\d+/g, '/*')
    return `${u.host}${path}`
  } catch {
    return url
  }
}

export function record(payload) {
  const fields = proseFields(payload.body)
  const entry = {
    id: `c${Date.now()}${candidates.length}`,
    method: payload.method,
    url: payload.url,
    pattern: urlPattern(payload.url),
    at: payload.at ?? Date.now(),
    fields: fields.map(([path, value]) => ({ path, value })),
    mint: findMint(payload.body),
  }
  candidates.unshift(entry)
  candidates.length = Math.min(candidates.length, MAX_CANDIDATES)
  return entry
}

export function listCandidates() {
  return candidates.filter((c) => c.fields.length)
}

/**
 * Once learned, a payload matching the same endpoint + field path is treated as
 * a thesis without asking again.
 */
export function match(payload) {
  const { extension } = getSettings()
  if (!extension?.pattern || !extension?.field) return null
  if (urlPattern(payload.url) !== extension.pattern) return null

  const thesis = getAtPath(payload.body, extension.field)
  if (!looksLikeProse(thesis)) return null

  return { thesis: thesis.trim(), mint: findMint(payload.body) }
}

export function learn({ pattern, field }) {
  saveSettings({ extension: { pattern, field, learnedAt: Date.now() } })
  return getSettings().extension
}

export function forget() {
  saveSettings({ extension: { pattern: '', field: '', learnedAt: 0 } })
  return getSettings().extension
}
