import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './paths.js'

const dbPath = join(dataDir, 'trades.json')

function load() {
  if (!existsSync(dbPath)) return { trades: [] }
  try {
    return JSON.parse(readFileSync(dbPath, 'utf8'))
  } catch {
    return { trades: [] }
  }
}

function save(db) {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(dbPath, JSON.stringify(db, null, 2))
}

// status: queued -> alerted -> enriched, or failed / dismissed
export function addTrade(swap) {
  const db = load()
  if (db.trades.some((t) => t.signature === swap.signature)) return null

  const trade = {
    ...swap,
    id: swap.signature.slice(0, 12),
    status: 'queued',
    thesis: '',
    alertedAt: null,
    enrichedAt: null,
    results: null, // the alert post
    thesisResults: null, // each thesis post is separate, never an edit
    thesisPosts: 0,
  }
  db.trades.unshift(trade)
  save(db)
  return trade
}

export function listTrades() {
  return load().trades
}

export function getTrade(id) {
  return load().trades.find((t) => t.id === id) ?? null
}

export function updateTrade(id, patch) {
  const db = load()
  const trade = db.trades.find((t) => t.id === id)
  if (!trade) return null
  Object.assign(trade, patch)
  save(db)
  return trade
}
