export function fmtNum(n) {
  if (!Number.isFinite(n) || n === 0) return '0'
  if (Math.abs(n) < 0.0001) return n.toExponential(2)
  if (Math.abs(n) >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return n.toLocaleString('en-US', { maximumSignificantDigits: 6 })
}

export function solscanUrl(signature) {
  return `https://solscan.io/tx/${signature}`
}

export function chartUrl(mint) {
  return `https://dexscreener.com/solana/${mint}`
}

export function headline(trade) {
  const verb = trade.side === 'BUY' ? 'Bought' : 'Sold'
  return `${verb} ${fmtNum(trade.asset.amount)} ${trade.asset.symbol} for ${fmtNum(trade.quote.amount)} ${trade.quote.symbol}`
}

/** The token's full name, only when it says more than the ticker already does. */
export function tokenName(trade) {
  const { name, symbol } = trade.asset
  if (!name || name === symbol) return ''
  return name
}

/** "— @handle", or nothing. Appended so posts are attributable to you. */
export function byline(settings) {
  const handle = settings.fomoUsername?.trim().replace(/^@/, '')
  return handle ? `@${handle}` : ''
}

/** Your fomo profile, or '' when no handle is set. */
export function profileUrl(settings) {
  const handle = settings.fomoUsername?.trim().replace(/^@/, '')
  return handle ? `https://fomo.family/profile/${encodeURIComponent(handle)}` : ''
}

/**
 * The contract address is deliberately absent from the alert and present only
 * on the thesis post — the alert says a trade happened, the thesis is what
 * invites anyone to act on it.
 */
export function contractAddress(trade) {
  return trade.asset.mint
}

/**
 * Per-channel: on X a post containing a link costs $0.200 instead of $0.015,
 * so it is opt-in there and on by default everywhere else.
 */
export function referralFor(settings, channel) {
  if (!settings.referralLink) return ''
  return settings.referralChannels?.[channel] ? settings.referralLink : ''
}
