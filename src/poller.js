import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSettings } from './settings.js'
import { parseRpcSwap } from './parse.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = join(root, 'data')
const cursorPath = join(dataDir, 'cursor.json')

const PUBLIC_RPC = 'https://api.mainnet-beta.solana.com'

// A long offline gap shouldn't fan out a hundred posts when the app restarts.
const MAX_PER_POLL = 15

export function rpcUrl() {
  const s = getSettings()
  if (s.rpcUrl) return s.rpcUrl
  if (s.heliusApiKey) return `https://mainnet.helius-rpc.com/?api-key=${s.heliusApiKey}`
  return PUBLIC_RPC
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function fail(message, retriable) {
  const err = new Error(message)
  // Retriable failures must never cause a signature to be skipped — the cursor
  // stops there and the next poll picks it up again. Skipping a rate-limited tx
  // and advancing past it silently loses the trade.
  err.retriable = retriable
  return err
}

// The default public RPC rate-limits aggressively, and a user without an API
// key lands there. Back off and retry rather than failing the whole poll.
async function rpc(method, params, { tries = 4 } = {}) {
  let wait = 600
  for (let i = 1; ; i++) {
    let res
    try {
      res = await fetch(rpcUrl(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      })
    } catch (err) {
      if (i >= tries) throw fail(`rpc unreachable: ${err.message}`, true)
      await sleep(wait)
      wait *= 2
      continue
    }

    const body = await res.text()
    const rateLimited = res.status === 429 || /"code":\s*429/.test(body)

    if (rateLimited) {
      if (i >= tries) throw fail('rate-limited by the public RPC — add a free Helius key in Setup', true)
      await sleep(wait)
      wait *= 2
      continue
    }
    if (!res.ok) throw fail(`rpc ${res.status}: ${body.slice(0, 120)}`, res.status >= 500)

    const json = JSON.parse(body)
    if (json.error) {
      // "not found" is permanent on a non-archive node: skip it and move on.
      const notFound = /not found/i.test(json.error.message ?? '')
      throw fail(`rpc: ${json.error.message}`, !notFound)
    }
    return json.result
  }
}

// Spacing between per-signature fetches. Free public RPCs tolerate roughly a
// few requests/sec; a paid endpoint doesn't need the gap.
function pace() {
  return getSettings().heliusApiKey || getSettings().rpcUrl ? 0 : 350
}

function readCursor() {
  if (!existsSync(cursorPath)) return {}
  try {
    return JSON.parse(readFileSync(cursorPath, 'utf8'))
  } catch {
    return {}
  }
}

function writeCursor(next) {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(cursorPath, JSON.stringify(next, null, 2))
}

export async function checkRpc() {
  const t0 = Date.now()
  const slot = await rpc('getSlot', [])
  return { ok: true, url: rpcUrl().replace(/api-key=[^&]+/, 'api-key=***'), slot, ms: Date.now() - t0 }
}

/**
 * Polls the wallet's recent signatures. No inbound connection, no webhook, no
 * public URL — works from any laptop behind NAT.
 *
 * On first run for a wallet it records the latest signature as a baseline and
 * broadcasts nothing, so connecting a channel never blasts your entire trade
 * history at it.
 */
export class Poller {
  constructor(onSwap) {
    this.onSwap = onSwap
    this.timer = null
    this.running = false
    this.lastError = null
    this.lastPollAt = null
  }

  start() {
    if (this.timer) return
    const tick = async () => {
      await this.poll().catch((err) => {
        this.lastError = err.message
      })
      const { pollSeconds } = getSettings()
      this.timer = setTimeout(tick, Math.max(5, Number(pollSeconds) || 15) * 1000)
    }
    tick()
  }

  stop() {
    clearTimeout(this.timer)
    this.timer = null
  }

  status() {
    const { wallet } = getSettings()
    return {
      watching: wallet || null,
      lastPollAt: this.lastPollAt,
      lastError: this.lastError,
      rpc: rpcUrl().replace(/api-key=[^&]+/, 'api-key=***'),
      baseline: readCursor()[wallet] ?? null,
    }
  }

  async poll() {
    const { wallet } = getSettings()
    if (!wallet || this.running) return
    this.running = true
    try {
      const cursor = readCursor()
      const known = cursor[wallet]

      const sigs = await rpc('getSignaturesForAddress', [
        wallet,
        known ? { until: known, limit: 50 } : { limit: 1 },
      ])
      this.lastPollAt = Date.now()
      this.lastError = null

      if (!sigs?.length) return

      // First sight of this wallet: baseline only, never backfill.
      if (!known) {
        cursor[wallet] = sigs[0].signature
        writeCursor(cursor)
        console.log(`[poll] baseline set for ${wallet.slice(0, 8)}… — watching from now`)
        return
      }

      // Oldest first, so broadcasts land in the order the trades happened.
      // Capped: a long offline gap shouldn't dump a hundred posts at once.
      const fresh = sigs.filter((s) => !s.err).reverse().slice(-MAX_PER_POLL)
      if (sigs.length > MAX_PER_POLL) {
        console.log(`[poll] ${sigs.length} new txs, processing the most recent ${MAX_PER_POLL}`)
      }

      const gap = pace()
      // Advance only past signatures actually dealt with. A retriable failure
      // stops the walk so the next poll resumes there rather than losing trades.
      let lastGood = known
      let stalled = null

      for (const [i, { signature }] of fresh.entries()) {
        if (i && gap) await sleep(gap)
        try {
          const tx = await rpc('getTransaction', [
            signature,
            { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
          ])
          if (tx) {
            const swap = parseRpcSwap(tx, wallet, signature)
            if (swap) await this.onSwap(swap)
          }
          lastGood = signature
        } catch (err) {
          if (err.retriable) {
            stalled = err.message
            break
          }
          // Permanently unreadable (non-archive node) — skip and keep going.
          console.log(`[poll] skipping ${signature.slice(0, 12)}…: ${err.message}`)
          lastGood = signature
        }
      }

      if (lastGood && lastGood !== known) {
        cursor[wallet] = lastGood
        writeCursor(cursor)
      }
      if (stalled) throw fail(stalled, true)
    } finally {
      this.running = false
    }
  }
}

/** Forget the baseline so the next poll re-baselines (used when the wallet changes). */
export function resetCursor(wallet) {
  const cursor = readCursor()
  if (wallet) delete cursor[wallet]
  else writeCursor({})
  writeCursor(cursor)
}
