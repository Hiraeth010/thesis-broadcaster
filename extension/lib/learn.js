// fomo has no public API and its thesis endpoint isn't in the public bundle, so
// nothing here is hardcoded. The hook forwards the requests your own tab already
// makes, and we learn which one carries a thesis — you point at it once.
//
// Candidates live in chrome.storage, not memory: the service worker is torn
// down between events, so a module-level array would be empty when the popup
// asks for it.

const MAX_CANDIDATES = 40
const MAX_OTHERS = 15
const MAX_SEEN = 40

// fomo fires telemetry and market data constantly — filterTokens, getBars,
// tokenDetails, RUM, analytics — while a thesis fires once. Recording those as
// candidates buried the one request that matters within seconds.
const NOISE_HOSTS = [/^app-actions\d*\./, /^solana-provider/, /^bundler/, /^evm-data/]
const NOISE_PATHS = [
  /^\/proxy\//,
  /^\/hodlers\//,
  /^\/tokenAllowList/,
  /^\/feed\/(react|unreact)/,
  /^\/v2\/users\/pushToken/,
]

export function isNoise(url) {
  try {
    const u = new URL(url)
    if (NOISE_HOSTS.some((re) => re.test(u.hostname))) return true
    if (NOISE_PATHS.some((re) => re.test(u.pathname))) return true
    return false
  } catch {
    return false
  }
}
// A thesis endpoint fires once; RPC and analytics chatter fires constantly, so
// the interesting request scrolls away fast if the buffer is small.
const MAX_FIELDS = 14
const FIELD_PREVIEW = 140

// A thesis is prose: long enough to be a sentence, short enough to be a post,
// and not an address/hash/id.
const MIN_LEN = 6
const MAX_LEN = 2000

function isIdish(v) {
  if (/^[0-9a-fA-F]{16,}$/.test(v)) return true // hash
  if (/^[0-9a-fA-F-]{32,}$/.test(v)) return true // uuid
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return true // base58 address
  if (/^https?:\/\//.test(v)) return true
  return false
}

/**
 * Only used to *offer* candidates in the picker. Deliberately conservative:
 * requiring a space keeps RPC method names and enum values out of the list.
 * It is NOT applied once a field has been chosen — see acceptThesis.
 */
function looksLikeProse(v) {
  if (typeof v !== 'string') return false
  if (v.length < MIN_LEN || v.length > MAX_LEN) return false
  if (isIdish(v)) return false
  if (!/\s/.test(v)) return false // single token, not a sentence
  return true
}

/**
 * Once you've pointed at a field and said "this is my thesis", believe you.
 * Re-running the discovery heuristic here silently dropped short theses on the
 * correct, already-learned endpoint — the picker's job is guessing, this one's
 * job is obeying.
 */
function acceptThesis(v) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_LEN
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
  // Every string field, not just the prose-looking ones, so the picker can be
  // overridden by hand when the guess is wrong.
  const allFields = [...walk(payload.body)]
    .filter(([, v]) => v.trim() && !isIdish(v))
    .slice(0, MAX_FIELDS)
    .map(([path, value]) => ({ path, value: value.slice(0, FIELD_PREVIEW) }))

  return {
    id: `c${payload.at ?? Date.now()}`,
    transport: payload.transport ?? 'fetch',
    method: payload.method,
    url: payload.url,
    pattern: urlPattern(payload.url),
    at: payload.at ?? Date.now(),
    fields: fields.map(([path, value]) => ({ path, value: value.slice(0, FIELD_PREVIEW) })),
    allFields,
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
  const { candidates, others, seen } = await chrome.storage.local.get(['candidates', 'others', 'seen'])

  const tally = seen ?? { total: 0, json: 0, byTransport: {}, recent: [] }
  tally.total++
  if (payload.body) tally.json++
  tally.byTransport[entry.transport] = (tally.byTransport[entry.transport] ?? 0) + 1
  tally.recent = [
    { pattern: entry.pattern, transport: entry.transport, at: entry.at, keys: payload.body ? Object.keys(payload.body).slice(0, 8) : null },
    ...(tally.recent ?? []),
  ].slice(0, MAX_SEEN)
  await chrome.storage.local.set({ seen: tally })

  // Telemetry and market data can never be a thesis, and there is a torrent of
  // it. Counted above, but never allowed into the picker.
  if (isNoise(payload.url)) return entry
  if (!entry.allFields.length) return entry

  // Two buckets on purpose. A thesis fires once; fomo's chatter fires dozens of
  // times a minute. In one shared FIFO the thesis was evicted within seconds of
  // being captured — which is exactly the bug this splits apart. Noise can now
  // only ever evict noise.
  if (entry.fields.length) {
    await chrome.storage.local.set({
      candidates: [entry, ...(candidates ?? [])].slice(0, MAX_CANDIDATES),
    })
  } else {
    await chrome.storage.local.set({
      others: [entry, ...(others ?? [])].slice(0, MAX_OTHERS),
    })
  }
  return entry
}

/** Prose guesses first, then anything pickable by hand. */
export async function listCandidates() {
  const { candidates, others } = await chrome.storage.local.get(['candidates', 'others'])
  return [...(candidates ?? []), ...(others ?? [])]
}

export async function getSeen() {
  const { seen } = await chrome.storage.local.get('seen')
  return seen ?? { total: 0, json: 0, byTransport: {}, recent: [] }
}

export async function clearCandidates() {
  await chrome.storage.local.set({
    candidates: [],
    others: [],
    seen: { total: 0, json: 0, byTransport: {}, recent: [] },
  })
}

/**
 * Once learned, a payload matching the same endpoint + field path is treated as
 * a thesis without asking again.
 */
export function match(learned, payload) {
  if (!learned?.pattern || !learned?.field) return null
  if (urlPattern(payload.url) !== learned.pattern) return null

  const thesis = getAtPath(payload.body, learned.field)
  if (!acceptThesis(thesis)) return null

  return { thesis: thesis.trim(), mint: findMint(payload.body) }
}
