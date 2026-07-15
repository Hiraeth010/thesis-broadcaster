import { config } from '../config.js'

function fmtNum(n) {
  if (!Number.isFinite(n)) return '0'
  if (n === 0) return '0'
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
  const parts = [headline(trade), '', trade.thesis.trim()]
  if (config.referralLink) parts.push('', config.referralLink)
  return parts.filter((p) => p !== undefined).join('\n').trim()
}

export { fmtNum }
