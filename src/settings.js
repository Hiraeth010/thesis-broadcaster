import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import 'dotenv/config'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = join(root, 'data')
const path = join(dataDir, 'config.json')

// Secrets live on this machine only — data/ is gitignored and nothing is sent
// anywhere except the channels the user configured.
const SECRET_FIELDS = new Set([
  'discord.webhookUrl',
  'telegram.botToken',
  'x.apiKey',
  'x.apiSecret',
  'x.accessToken',
  'x.accessSecret',
])

const DEFAULTS = {
  wallet: '',
  referralLink: '',
  autoBroadcast: true,
  discord: { webhookUrl: '' },
  telegram: { botToken: '', chatId: '' },
  x: { apiKey: '', apiSecret: '', accessToken: '', accessSecret: '' },
}

function fromEnv() {
  return {
    wallet: process.env.WALLET_ADDRESS || '',
    referralLink: process.env.REFERRAL_LINK || '',
    discord: { webhookUrl: process.env.DISCORD_WEBHOOK_URL || '' },
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
      chatId: process.env.TELEGRAM_CHAT_ID || '',
    },
    x: {
      apiKey: process.env.X_API_KEY || '',
      apiSecret: process.env.X_API_SECRET || '',
      accessToken: process.env.X_ACCESS_TOKEN || '',
      accessSecret: process.env.X_ACCESS_SECRET || '',
    },
  }
}

function readFile() {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

function deepMerge(...sources) {
  const out = {}
  for (const src of sources) {
    for (const [k, v] of Object.entries(src ?? {})) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = deepMerge(out[k] ?? {}, v)
      } else if (v !== '' && v !== undefined) {
        out[k] = v
      } else if (!(k in out)) {
        out[k] = v
      }
    }
  }
  return out
}

// .env wins over the UI file, so anyone who prefers dotfiles keeps working.
export function getSettings() {
  return deepMerge(DEFAULTS, readFile(), fromEnv())
}

function get(obj, dotted) {
  return dotted.split('.').reduce((o, k) => o?.[k], obj)
}

function unset(obj, dotted) {
  const keys = dotted.split('.')
  const last = keys.pop()
  const target = keys.reduce((o, k) => o?.[k], obj)
  if (target) delete target[last]
}

/**
 * For secret fields: a string sets it, null clears it, and absent/empty leaves
 * it alone. Secrets are never echoed to the browser, so "unchanged" has to be
 * expressible without the caller knowing the current value.
 */
export function saveSettings(patch) {
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

  const next = deepMerge(readFile(), incoming)
  for (const dotted of clears) unset(next, dotted)

  mkdirSync(dataDir, { recursive: true })
  writeFileSync(path, JSON.stringify(next, null, 2))
  return getSettings()
}

/**
 * Settings safe to hand to the UI. Secrets are blanked, never masked with a
 * sentinel — a sentinel that survives a round trip can overwrite the real
 * value if encoding mangles it. The UI learns only whether a value is set.
 */
export function maskedSettings() {
  const s = getSettings()
  const out = structuredClone(s)
  const configured = {}
  for (const dotted of SECRET_FIELDS) {
    configured[dotted] = Boolean(get(s, dotted))
    const [group, key] = dotted.split('.')
    out[group][key] = ''
  }
  out.configured = configured
  return out
}

export function enabledChannels(s = getSettings()) {
  return {
    discord: Boolean(s.discord.webhookUrl),
    telegram: Boolean(s.telegram.botToken && s.telegram.chatId),
    x: Boolean(s.x.apiKey && s.x.accessToken),
  }
}

export function envLocked() {
  const env = fromEnv()
  return {
    wallet: Boolean(env.wallet),
    discord: Boolean(env.discord.webhookUrl),
    telegram: Boolean(env.telegram.botToken),
    x: Boolean(env.x.apiKey),
  }
}
