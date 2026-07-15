// Trades live in chrome.storage.local. The service worker is torn down between
// alarms, so nothing may be held in memory across ticks.

const MAX_TRADES = 100

export async function listTrades() {
  const { trades } = await chrome.storage.local.get('trades')
  return trades ?? []
}

async function write(trades) {
  await chrome.storage.local.set({ trades: trades.slice(0, MAX_TRADES) })
}

// status: queued -> alerted -> enriched, or failed / dismissed
export async function addTrade(swap) {
  const trades = await listTrades()
  if (trades.some((t) => t.signature === swap.signature)) return null

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
  trades.unshift(trade)
  await write(trades)
  return trade
}

export async function getTrade(id) {
  return (await listTrades()).find((t) => t.id === id) ?? null
}

export async function updateTrade(id, patch) {
  const trades = await listTrades()
  const trade = trades.find((t) => t.id === id)
  if (!trade) return null
  Object.assign(trade, patch)
  await write(trades)
  return trade
}

export async function getCursor(wallet) {
  const { cursor } = await chrome.storage.local.get('cursor')
  return cursor?.[wallet] ?? null
}

export async function setCursor(wallet, signature) {
  const { cursor } = await chrome.storage.local.get('cursor')
  await chrome.storage.local.set({ cursor: { ...(cursor ?? {}), [wallet]: signature } })
}

export async function clearCursor(wallet) {
  const { cursor } = await chrome.storage.local.get('cursor')
  if (!cursor) return
  delete cursor[wallet]
  await chrome.storage.local.set({ cursor })
}

export async function getStatus() {
  const { status } = await chrome.storage.local.get('status')
  return status ?? { lastPollAt: null, lastError: null }
}

export async function setStatus(patch) {
  const status = await getStatus()
  await chrome.storage.local.set({ status: { ...status, ...patch } })
}
