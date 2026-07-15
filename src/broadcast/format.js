import { getSettings } from '../settings.js'

export function fmtNum(n) {
  if (!Number.isFinite(n) || n === 0) return '0'
  if (Math.abs(n) < 0.0001) return n.toExponential(2)
  if (Math.abs(n) >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return n.toLocaleString('en-US', { maximumSignificantDigits: 6 })
}

export function solscanUrl(signature) {
  return `https://solscan.io/tx/${signature}`
}

export function headline(trade) {
  const verb = trade.side === 'BUY' ? 'Bought' : 'Sold'
  return `${verb} ${fmtNum(trade.asset.amount)} ${trade.asset.symbol} for ${fmtNum(trade.quote.amount)} ${trade.quote.symbol}`
}

/**
 * The contract address is deliberately absent from the alert and present only
 * on the thesis post — the alert says a trade happened, the thesis is what
 * invites anyone to act on it.
 */
export function contractAddress(trade) {
  return trade.asset.mint
}

export function plainText(trade, variant = 'thesis') {
  const { referralLink } = getSettings()
  const lines = [headline(trade)]

  if (variant === 'thesis') {
    if (trade.thesis?.trim()) lines.push(trade.thesis.trim())
    lines.push(`CA: ${contractAddress(trade)}`)
  }
  if (referralLink) lines.push(referralLink)

  return lines.filter(Boolean).join('\n\n')
}
