// fomo has no public API and its thesis endpoint isn't in the public bundle, so
// nothing here is hardcoded. The hook forwards the requests your own tab already
// makes, and we learn which one carries a thesis — you point at it once.
//
// Candidates live in chrome.storage, not memory: the service worker is torn
// down between events, so a module-level array would be empty when the popup
// asks for it.

const MAX_CANDIDATES = 25

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

export function urlPattern(url) {
  try {
    const u = new URL(url)
    // Ids in the path would make the pattern too specific to match next time.
    const path = u.pathname.replace(/\/[0-9a-fA-F-]{8,}/g, '/*').replace(/\/\d+/g, '/*')
    return `${u.host}${path}`
  } catch {
    return url
  }
}

export function describe(payload) {
  const fields = proseFields(payload.body)
  return {
    id: `c${payload.at ?? Date.now()}`,
    method: payload.method,
    url: payload.url,
    pattern: urlPattern(payload.url),
    at: payload.at ?? Date.now(),
    fields: fields.map(([path, value]) => ({ path, value })),
    mint: findMint(payload.body),
  }
}

export async function record(payload) {
  const entry = describe(payload)
  if (!entry.fields.length) return entry // nothing a human could pick

  const { candidates } = await chrome.storage.local.get('candidates')
  const next = [entry, ...(candidates ?? [])].slice(0, MAX_CANDIDATES)
  await chrome.storage.local.set({ candidates: next })
  return entry
}

export async function listCandidates() {
  const { candidates } = await chrome.storage.local.get('candidates')
  return candidates ?? []
}

export async function clearCandidates() {
  await chrome.storage.local.set({ candidates: [] })
}

/**
 * Once learned, a payload matching the same endpoint + field path is treated as
 * a thesis without asking again.
 */
export function match(learned, payload) {
  if (!learned?.pattern || !learned?.field) return null
  if (urlPattern(payload.url) !== learned.pattern) return null

  const thesis = getAtPath(payload.body, learned.field)
  if (!looksLikeProse(thesis)) return null

  return { thesis: thesis.trim(), mint: findMint(payload.body) }
}
