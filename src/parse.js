const LAMPORTS_PER_SOL = 1_000_000_000

// Mints treated as the "quote" side of a swap. The non-quote leg is the asset
// being bought or sold.
const QUOTE_MINTS = {
  So11111111111111111111111111111111111111112: { symbol: 'SOL', decimals: 9 },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', decimals: 6 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: 'USDT', decimals: 6 },
}

const NATIVE_SOL = 'So11111111111111111111111111111111111111112'

// Native SOL moves that are just rent/fees rather than swap value. Ignoring
// dust keeps ATA rent (~0.002 SOL) and tx fees from being read as the quote leg.
const DUST_SOL = 0.001

function addDelta(deltas, mint, amount) {
  if (!mint || !amount) return
  deltas.set(mint, (deltas.get(mint) ?? 0) + amount)
}

function applyNativeSol(deltas, lamports) {
  const sol = lamports / LAMPORTS_PER_SOL
  if (Math.abs(sol) > DUST_SOL) addDelta(deltas, NATIVE_SOL, sol)
}

/** Net balance change per mint, from a Helius enhanced transaction. */
export function deltasFromEnhanced(tx, wallet) {
  const deltas = new Map()

  for (const t of tx.tokenTransfers ?? []) {
    const amount = Number(t.tokenAmount ?? 0)
    if (t.fromUserAccount === wallet) addDelta(deltas, t.mint, -amount)
    if (t.toUserAccount === wallet) addDelta(deltas, t.mint, amount)
  }

  let lamports = 0
  for (const n of tx.nativeTransfers ?? []) {
    const amount = Number(n.amount ?? 0)
    if (n.fromUserAccount === wallet) lamports -= amount
    if (n.toUserAccount === wallet) lamports += amount
  }
  applyNativeSol(deltas, lamports)

  return deltas
}

/**
 * Net balance change per mint, from a raw `getTransaction` (jsonParsed) result.
 * Uses pre/post balances, so it works against any Solana RPC — no indexer and
 * no API key required.
 */
export function deltasFromRpc(tx, wallet) {
  const deltas = new Map()
  const meta = tx?.meta
  if (!meta || meta.err) return deltas

  const sum = (rows) => {
    const out = new Map()
    for (const b of rows ?? []) {
      if (b.owner !== wallet) continue
      const amt = Number(b.uiTokenAmount?.uiAmount ?? 0)
      out.set(b.mint, (out.get(b.mint) ?? 0) + amt)
    }
    return out
  }

  const pre = sum(meta.preTokenBalances)
  const post = sum(meta.postTokenBalances)
  for (const mint of new Set([...pre.keys(), ...post.keys()])) {
    addDelta(deltas, mint, (post.get(mint) ?? 0) - (pre.get(mint) ?? 0))
  }

  const keys = tx.transaction?.message?.accountKeys ?? []
  const idx = keys.findIndex((k) => (typeof k === 'string' ? k : k.pubkey) === wallet)
  if (idx >= 0 && meta.preBalances && meta.postBalances) {
    applyNativeSol(deltas, meta.postBalances[idx] - meta.preBalances[idx])
  }

  return deltas
}

function classify(deltas, { signature, timestamp, source }) {
  const outgoing = []
  const incoming = []
  for (const [mint, amount] of deltas) {
    if (amount < 0) outgoing.push({ mint, amount: Math.abs(amount) })
    if (amount > 0) incoming.push({ mint, amount })
  }
  if (!outgoing.length || !incoming.length) return null

  const largest = (arr) => arr.reduce((a, b) => (b.amount > a.amount ? b : a))
  const sold = largest(outgoing)
  const bought = largest(incoming)

  const soldIsQuote = Boolean(QUOTE_MINTS[sold.mint])
  const boughtIsQuote = Boolean(QUOTE_MINTS[bought.mint])

  // Quote-to-quote (SOL->USDC) has no asset leg worth a thesis; token-to-token
  // has no price we can express.
  if (soldIsQuote === boughtIsQuote) return null

  const side = soldIsQuote ? 'BUY' : 'SELL'
  const asset = soldIsQuote ? bought : sold
  const quote = soldIsQuote ? sold : bought

  return {
    signature,
    timestamp,
    side,
    source: source ?? 'UNKNOWN',
    asset: { mint: asset.mint, amount: asset.amount, symbol: shortMint(asset.mint) },
    quote: { mint: quote.mint, amount: quote.amount, symbol: QUOTE_MINTS[quote.mint].symbol },
    price: asset.amount > 0 ? quote.amount / asset.amount : 0,
  }
}

function shortMint(mint) {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`
}

export function parseSwap(tx, wallet) {
  return classify(deltasFromEnhanced(tx, wallet), {
    signature: tx.signature,
    timestamp: (tx.timestamp ?? Math.floor(Date.now() / 1000)) * 1000,
    source: tx.source,
  })
}

export function parseRpcSwap(tx, wallet, signature) {
  return classify(deltasFromRpc(tx, wallet), {
    signature: signature ?? tx.transaction?.signatures?.[0],
    timestamp: (tx.blockTime ?? Math.floor(Date.now() / 1000)) * 1000,
    source: 'ON-CHAIN',
  })
}

export function parseWebhookBody(body, wallet) {
  const txs = Array.isArray(body) ? body : [body]
  return txs.map((tx) => parseSwap(tx, wallet)).filter(Boolean)
}
