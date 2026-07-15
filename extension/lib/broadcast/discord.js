import {
  byline, chartUrl, contractAddress, fmtNum, headline, referralFor, solscanUrl, tokenName,
} from '../format.js'

function embedFor(trade, variant, referralLink, who) {
  const isThesis = variant === 'thesis'
  const mint = contractAddress(trade)

  const embed = {
    title: headline(trade),
    url: chartUrl(mint),
    description: isThesis ? trade.thesis?.trim() || undefined : undefined,
    color: trade.side === 'BUY' ? 0x22c55e : 0xef4444,
    author: who ? { name: who } : undefined,
    fields: [
      { name: 'Side', value: trade.side, inline: true },
      { name: 'Price', value: `${fmtNum(trade.price)} ${trade.quote.symbol}`, inline: true },
      { name: 'Venue', value: `[${trade.source}](${solscanUrl(trade.signature)})`, inline: true },
    ],
    timestamp: new Date(trade.timestamp).toISOString(),
  }

  const name = tokenName(trade)
  if (name) embed.fields.unshift({ name: 'Token', value: name, inline: false })

  // CA only on the thesis post. [`code`](url) renders as inline code that is
  // still clickable — a plain link can't be copied, plain code can't be tapped.
  if (isThesis) {
    embed.fields.push({ name: 'CA', value: `[\`${mint}\`](${chartUrl(mint)})` })
  }
  if (referralLink) embed.footer = { text: referralLink }

  return embed
}

export async function send(settings, trade, variant = 'alert') {
  const url = settings.discord.webhookUrl
  if (!url) return { ok: false, skipped: true, reason: 'discord not configured' }

  const res = await fetch(`${url}?wait=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      embeds: [embedFor(trade, variant, referralFor(settings, 'discord'), byline(settings))],
    }),
  })

  if (!res.ok) {
    return { ok: false, reason: `discord ${res.status}: ${(await res.text()).slice(0, 200)}` }
  }
  const msg = await res.json().catch(() => ({}))
  return { ok: true, ref: msg.id ?? null }
}
