// Turns a mint into a real name. The parser only ever sees the mint, so without
// this every post says "2qEH…pump" instead of "Pnut".
//
// Jupiter first, DexScreener as a fallback — both answer cross-origin and need
// no key. Results are cached because a mint's symbol doesn't change.

const TTL_MS = 7 * 24 * 60 * 60 * 1000
const TIMEOUT_MS = 6000

const KNOWN = {
  So11111111111111111111111111111111111111112: { symbol: 'SOL', name: 'Solana' },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', name: 'USD Coin' },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: 'USDT', name: 'Tether' },
}

function shortMint(mint) {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`
}

async function withTimeout(promise) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    return await promise(ctl.signal)
  } finally {
    clearTimeout(t)
  }
}

async function fromJupiter(mint) {
  const res = await withTimeout((signal) =>
    fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`, { signal })
  )
  if (!res.ok) return null
  const list = await res.json()
  const hit = Array.isArray(list) ? list.find((t) => t.id === mint || t.address === mint) ?? list[0] : null
  if (!hit?.symbol) return null
  return { symbol: String(hit.symbol).trim(), name: String(hit.name ?? hit.symbol).trim() }
}

async function fromDexScreener(mint) {
  const res = await withTimeout((signal) =>
    fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { signal })
  )
  if (!res.ok) return null
  const json = await res.json()
  const base = json?.pairs?.find((p) => p?.baseToken?.address === mint)?.baseToken
  if (!base?.symbol) return null
  return { symbol: String(base.symbol).trim(), name: String(base.name ?? base.symbol).trim() }
}

/**
 * Never throws and never blocks a broadcast: an unknown token still posts, just
 * with the shortened mint it would have shown anyway.
 */
export async function resolveToken(mint) {
  if (KNOWN[mint]) return KNOWN[mint]

  const { tokenCache } = await chrome.storage.local.get('tokenCache')
  const cache = tokenCache ?? {}
  const hit = cache[mint]
  if (hit && Date.now() - hit.at < TTL_MS) return { symbol: hit.symbol, name: hit.name }

  let found = null
  for (const source of [fromJupiter, fromDexScreener]) {
    try {
      found = await source(mint)
      if (found) break
    } catch {
      // try the next source
    }
  }

  const value = found ?? { symbol: shortMint(mint), name: shortMint(mint) }
  cache[mint] = { ...value, at: Date.now() }
  await chrome.storage.local.set({ tokenCache: cache })
  return value
}
