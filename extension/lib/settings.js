// Settings live in chrome.storage.local — on this machine, in this browser.
// Nothing is synced and nothing leaves except to the channels you connect.
//
// Everything downstream takes settings as an argument rather than reading a
// global: an MV3 service worker is torn down between alarms, so a module-level
// cache would be stale or empty half the time.

// Where fomo posts a thesis. Verified two ways: their bundle calls
// C("/trades/comment", {method:"POST", body: JSON.stringify({tradeId, comment,
// visibility:"public"})}), and live traffic confirms the same host and shape.
export const KNOWN_FOMO_THESIS = {
  pattern: 'prod-api.fomo.family/trades/comment',
  field: 'comment',
}

export const DEFAULTS = {
  wallet: '',
  // Just typed in. Looking it up would mean querying fomo for who owns a
  // wallet, which is the one thing this deliberately never does — and you
  // already know your own handle.
  fomoUsername: '',
  referralLink: '',
  // Per-channel: on X a link turns a $0.015 post into a $0.200 one.
  referralChannels: { discord: true, telegram: true, x: false },
  rpcUrl: '',
  heliusApiKey: '',
  pollMinutes: 1,
  discord: { webhookUrl: '' },
  telegram: { botToken: '', chatId: '' },
  x: { apiKey: '', apiSecret: '', accessToken: '', accessSecret: '' },
  // fomo's thesis endpoint, confirmed from their own bundle and from live
  // traffic: C("/trades/comment", {body: JSON.stringify({tradeId, comment, visibility})}).
  // It ships as the default so nothing has to be picked — the picker in
  // lib/learn.js is only a fallback for when fomo changes this.
  learn: { ...KNOWN_FOMO_THESIS, learnedAt: 0 },
}

export const SECRET_FIELDS = [
  'discord.webhookUrl',
  'telegram.botToken',
  'heliusApiKey',
  'x.apiKey',
  'x.apiSecret',
  'x.accessToken',
  'x.accessSecret',
]

function get(obj, dotted) {
  return dotted.split('.').reduce((o, k) => o?.[k], obj)
}

function set(obj, dotted, value) {
  const keys = dotted.split('.')
  const last = keys.pop()
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj)
  target[last] = value
}

function unset(obj, dotted) {
  const keys = dotted.split('.')
  const last = keys.pop()
  const target = keys.reduce((o, k) => o?.[k], obj)
  if (target) delete target[last]
}

function deepMerge(...sources) {
  const out = {}
  for (const src of sources) {
    for (const [k, v] of Object.entries(src ?? {})) {
      if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = deepMerge(out[k] ?? {}, v)
      else if (v !== undefined) out[k] = v
    }
  }
  return out
}

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings')
  const merged = deepMerge(DEFAULTS, settings ?? {})

  // An empty pattern means "nothing chosen", not "disconnected" — fall back to
  // the known endpoint. Without this, anyone who ever hit Forget (or installed
  // before the default existed) would be stuck picking by hand forever.
  if (!merged.learn?.pattern || !merged.learn?.field) {
    merged.learn = { ...KNOWN_FOMO_THESIS, learnedAt: merged.learn?.learnedAt ?? 0 }
  }
  return merged
}

/**
 * Secret fields: a string sets it, null clears it, '' or absent leaves it
 * alone. Secrets are never handed to the UI, so "unchanged" has to be
 * expressible without the caller knowing the current value.
 */
export async function saveSettings(patch) {
  const { settings: current } = await chrome.storage.local.get('settings')
  const incoming = structuredClone(patch ?? {})
  const clears = []

  for (const dotted of SECRET_FIELDS) {
    const v = get(incoming, dotted)
    if (v === null) {
      clears.push(dotted)
      unset(incoming, dotted)
    } else if (v === '' || v === undefined) {
      unset(incoming, dotted)
    }
  }

  const next = deepMerge(current ?? {}, incoming)
  for (const dotted of clears) unset(next, dotted)

  await chrome.storage.local.set({ settings: next })
  return loadSettings()
}

/**
 * Safe to hand to the options page. Secrets are blanked rather than masked with
 * a sentinel — a sentinel that survives a round trip can overwrite the real
 * value. The UI learns only whether a value is set.
 */
export async function publicSettings() {
  const s = await loadSettings()
  const out = structuredClone(s)
  const configured = {}
  for (const dotted of SECRET_FIELDS) {
    configured[dotted] = Boolean(get(s, dotted))
    set(out, dotted, '')
  }
  out.configured = configured
  return out
}

export function enabledChannels(s) {
  return {
    discord: Boolean(s.discord.webhookUrl),
    telegram: Boolean(s.telegram.botToken && s.telegram.chatId),
    x: Boolean(s.x.apiKey && s.x.accessToken),
  }
}
