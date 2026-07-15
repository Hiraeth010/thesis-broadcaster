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
// dust keeps ATA rent (~0.002 SOL) from being mistaken for the quote leg.
const DUST_SOL = 0.001

function netTokenDeltas(tx, wallet) {
  const deltas = new Map()

  for (const t of tx.tokenTransfers ?? []) {
    const amount = Number(t.tokenAmount ?? 0)
    if (!amount || !t.mint) continue
    if (t.fromUserAccount === wallet) {
      deltas.set(t.mint, (deltas.get(t.mint) ?? 0) - amount)
    }
    if (t.toUserAccount === wallet) {
      deltas.set(t.mint, (deltas.get(t.mint) ?? 0) + amount)
    }
  }

  let nativeLamports = 0
  for (const n of tx.nativeTransfers ?? []) {
    const amount = Number(n.amount ?? 0)
    if (!amount) continue
    if (n.fromUserAccount === wallet) nativeLamports -= amount
    if (n.toUserAccount === wallet) nativeLamports += amount
  }

  const nativeSol = nativeLamports / LAMPORTS_PER_SOL
  if (Math.abs(nativeSol) > DUST_SOL) {
    deltas.set(NATIVE_SOL, (deltas.get(NATIVE_SOL) ?? 0) + nativeSol)
  }

  return deltas
}

/**
 * Derive a swap from net wallet balance deltas rather than from the router that
 * produced it. Works for Jupiter, Relay, or anything else that moves value in
 * one transaction.
 *
 * Returns null when the transaction is not a two-sided swap for this wallet.
 */
export function parseSwap(tx, wallet) {
  const deltas = netTokenDeltas(tx, wallet)

  const outgoing = []
  const incoming = []
  for (const [mint, amount] of deltas) {
    if (amount < 0) outgoing.push({ mint, amount: Math.abs(amount) })
    if (amount > 0) incoming.push({ mint, amount })
  }

  if (!outgoing.length || !incoming.length) return null

  const pickLargest = (arr) => arr.reduce((a, b) => (b.amount > a.amount ? b : a))
  const sold = pickLargest(outgoing)
  const bought = pickLargest(incoming)

  const soldIsQuote = Boolean(QUOTE_MINTS[sold.mint])
  const boughtIsQuote = Boolean(QUOTE_MINTS[bought.mint])

  // Quote-to-quote (e.g. SOL->USDC) has no asset leg worth a thesis.
  if (soldIsQuote && boughtIsQuote) return null
  if (!soldIsQuote && !boughtIsQuote) return null

  const side = soldIsQuote ? 'BUY' : 'SELL'
  const asset = soldIsQuote ? bought : sold
  const quote = soldIsQuote ? sold : bought
  const quoteMeta = QUOTE_MINTS[quote.mint]

  const price = asset.amount > 0 ? quote.amount / asset.amount : 0

  return {
    signature: tx.signature,
    timestamp: (tx.timestamp ?? Math.floor(Date.now() / 1000)) * 1000,
    side,
    source: tx.source ?? 'UNKNOWN',
    asset: {
      mint: asset.mint,
      amount: asset.amount,
      symbol: symbolFor(tx, asset.mint),
    },
    quote: {
      mint: quote.mint,
      amount: quote.amount,
      symbol: quoteMeta.symbol,
    },
    price,
  }
}

// Helius enhanced payloads don't reliably carry a symbol, so fall back to a
// truncated mint until the dashboard resolves it.
function symbolFor(tx, mint) {
  const fromEvents = tx.events?.swap?.tokenInputs?.find((t) => t.mint === mint)?.symbol
  return fromEvents || `${mint.slice(0, 4)}…${mint.slice(-4)}`
}

export function parseWebhookBody(body, wallet) {
  const txs = Array.isArray(body) ? body : [body]
  return txs.map((tx) => parseSwap(tx, wallet)).filter(Boolean)
}
