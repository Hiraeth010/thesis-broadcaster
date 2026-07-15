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

/**
 * The referral link is per-channel: on X a post containing a link costs $0.200
 * instead of $0.015, so it is opt-in there and on by default everywhere else.
 */
export function referralFor(channel) {
  const { referralLink, referralChannels } = getSettings()
  if (!referralLink) return ''
  return referralChannels?.[channel] ? referralLink : ''
}

export function plainText(trade, variant = 'thesis', channel = 'x') {
  const lines = [headline(trade)]

  if (variant === 'thesis') {
    if (trade.thesis?.trim()) lines.push(trade.thesis.trim())
    lines.push(`CA: ${contractAddress(trade)}`)
  }
  const referral = referralFor(channel)
  if (referral) lines.push(referral)

  return lines.filter(Boolean).join('\n\n')
}
