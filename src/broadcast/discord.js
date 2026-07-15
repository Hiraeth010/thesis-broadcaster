import { config } from '../config.js'
import { fmtNum, headline, solscanUrl } from './format.js'

export async function send(trade) {
  const url = config.discord.webhookUrl
  if (!url) return { ok: false, skipped: true, reason: 'DISCORD_WEBHOOK_URL not set' }

  const embed = {
    title: headline(trade),
    url: solscanUrl(trade.signature),
    description: trade.thesis.trim() || undefined,
    color: trade.side === 'BUY' ? 0x22c55e : 0xef4444,
    fields: [
      { name: 'Side', value: trade.side, inline: true },
      { name: 'Price', value: `${fmtNum(trade.price)} ${trade.quote.symbol}`, inline: true },
      { name: 'Venue', value: trade.source, inline: true },
    ],
    timestamp: new Date(trade.timestamp).toISOString(),
  }

  if (config.referralLink) {
    embed.footer = { text: config.referralLink }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  })

  if (!res.ok) {
    return { ok: false, reason: `discord ${res.status}: ${(await res.text()).slice(0, 200)}` }
  }
  return { ok: true }
}
