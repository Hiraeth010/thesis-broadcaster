// fomo has no public API and its thesis endpoint isn't in the public bundle, so
// nothing here is hardcoded. The hook forwards the requests your own tab already
// makes, and we learn which one carries a thesis — you point at it once.
//
// Candidates live in chrome.storage, not memory: the service worker is torn
// down between events, so a module-level array would be empty when the popup
// asks for it.

const MAX_CANDIDATES = 25
const MAX_SEEN = 12

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
    transport: payload.transport ?? 'fetch',
    method: payload.method,
    url: payload.url,
    pattern: urlPattern(payload.url),
    at: payload.at ?? Date.now(),
    fields: fields.map(([path, value]) => ({ path, value })),
    mint: findMint(payload.body),
  }
}

/**
 * Everything the hook sees is counted, but only payloads with a prose field can
 * be picked. The counters exist so the popup can tell "the hook isn't running"
 * apart from "the hook is running but fomo never sends a thesis this way" —
 * without them, both look identical and there's nothing to debug with.
 */
export async function record(payload) {
  const entry = describe(payload)
  const { candidates, seen } = await chrome.storage.local.get(['candidates', 'seen'])

  const tally = seen ?? { total: 0, json: 0, byTransport: {}, recent: [] }
  tally.total++
  if (payload.body) tally.json++
  tally.byTransport[entry.transport] = (tally.byTransport[entry.transport] ?? 0) + 1
  tally.recent = [
    { pattern: entry.pattern, transport: entry.transport, at: entry.at, keys: payload.body ? Object.keys(payload.body).slice(0, 8) : null },
    ...(tally.recent ?? []),
  ].slice(0, MAX_SEEN)
  await chrome.storage.local.set({ seen: tally })

  if (!entry.fields.length) return entry // nothing a human could pick

  const next = [entry, ...(candidates ?? [])].slice(0, MAX_CANDIDATES)
  await chrome.storage.local.set({ candidates: next })
  return entry
}

export async function listCandidates() {
  const { candidates } = await chrome.storage.local.get('candidates')
  return candidates ?? []
}

export async function getSeen() {
  const { seen } = await chrome.storage.local.get('seen')
  return seen ?? { total: 0, json: 0, byTransport: {}, recent: [] }
}

export async function clearCandidates() {
  await chrome.storage.local.set({ candidates: [], seen: { total: 0, json: 0, byTransport: {}, recent: [] } })
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
