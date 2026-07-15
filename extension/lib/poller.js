import { parseRpcSwap } from './parse.js'
import { getCursor, setCursor, setStatus } from './store.js'

// NOT api.mainnet-beta.solana.com: it returns 403 "Access forbidden" to any
// browser origin, which is every request an extension makes. publicnode answers
// cross-origin and doesn't rate-limit a burst of getTransaction calls the way
// the official endpoint does.
const PUBLIC_RPC = 'https://solana-rpc.publicnode.com'

// A long gap (browser closed overnight) shouldn't fan out a hundred posts.
const MAX_PER_POLL = 15

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function rpcUrl(settings) {
  if (settings.rpcUrl) return settings.rpcUrl
  if (settings.heliusApiKey) return `https://mainnet.helius-rpc.com/?api-key=${settings.heliusApiKey}`
  return PUBLIC_RPC
}

export function redactRpc(url) {
  return url.replace(/api-key=[^&]+/, 'api-key=***')
}

function fail(message, retriable) {
  const err = new Error(message)
  // Retriable failures must never cause a signature to be skipped — the cursor
  // stops there and the next poll picks it up again. Skipping a rate-limited tx
  // and advancing past it silently loses the trade.
  err.retriable = retriable
  return err
}

async function rpc(settings, method, params, { tries = 4 } = {}) {
  let wait = 600
  for (let i = 1; ; i++) {
    let res
    try {
      res = await fetch(rpcUrl(settings), {
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
    if (res.status === 429 || /"code":\s*429/.test(body)) {
      if (i >= tries) throw fail('rate-limited by the public RPC — add a free Helius key in Setup', true)
      await sleep(wait)
      wait *= 2
      continue
    }

    // 403 here almost always means the endpoint refuses browser origins rather
    // than anything being wrong with the wallet — say so, since the raw message
    // ("Access forbidden") sends people looking in the wrong place.
    if (res.status === 403 || /"code":\s*403/.test(body)) {
      throw fail(
        `this RPC refuses browser extensions (403). Leave the custom RPC blank to use the default, or add a free Helius key in Setup.`,
        false
      )
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

export async function checkRpc(settings) {
  const t0 = Date.now()
  const slot = await rpc(settings, 'getSlot', [])
  return { ok: true, url: redactRpc(rpcUrl(settings)), slot, ms: Date.now() - t0 }
}

// Free public RPCs tolerate only a few requests/sec; a paid endpoint doesn't
// need the gap.
const pace = (settings) => (settings.heliusApiKey || settings.rpcUrl ? 0 : 350)

/**
 * Polls the wallet's recent signatures. On first sight of a wallet it records
 * the latest signature as a baseline and broadcasts nothing, so connecting a
 * channel never blasts your entire trade history at it.
 */
export async function poll(settings, onSwap) {
  const wallet = settings.wallet
  if (!wallet) return { swaps: 0 }

  const known = await getCursor(wallet)
  const sigs = await rpc(settings, 'getSignaturesForAddress', [
    wallet,
    known ? { until: known, limit: 50 } : { limit: 1 },
  ])
  await setStatus({ lastPollAt: Date.now(), lastError: null })

  if (!sigs?.length) return { swaps: 0 }

  if (!known) {
    await setCursor(wallet, sigs[0].signature)
    console.log(`[poll] baseline set for ${wallet.slice(0, 8)}… — watching from now`)
    return { swaps: 0, baselined: true }
  }

  const fresh = sigs.filter((s) => !s.err).reverse().slice(-MAX_PER_POLL)
  if (sigs.length > MAX_PER_POLL) {
    console.log(`[poll] ${sigs.length} new txs, processing the most recent ${MAX_PER_POLL}`)
  }

  // Advance only past signatures actually dealt with. A retriable failure stops
  // the walk so the next poll resumes there rather than losing trades.
  let lastGood = known
  let stalled = null
  let swaps = 0
  const gap = pace(settings)

  for (const [i, { signature }] of fresh.entries()) {
    if (i && gap) await sleep(gap)
    try {
      const tx = await rpc(settings, 'getTransaction', [
        signature,
        { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
      ])
      if (tx) {
        const swap = parseRpcSwap(tx, wallet, signature)
        if (swap) {
          await onSwap(swap)
          swaps++
        }
      }
      lastGood = signature
    } catch (err) {
      if (err.retriable) {
        stalled = err.message
        break
      }
      console.log(`[poll] skipping ${signature.slice(0, 12)}…: ${err.message}`)
      lastGood = signature
    }
  }

  if (lastGood && lastGood !== known) await setCursor(wallet, lastGood)
  if (stalled) throw fail(stalled, true)
  return { swaps }
}
