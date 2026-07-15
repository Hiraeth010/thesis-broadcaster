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

export function plainText(trade) {
  const { referralLink } = getSettings()
  return [headline(trade), trade.thesis?.trim(), referralLink]
    .filter(Boolean)
    .join('\n\n')
}
