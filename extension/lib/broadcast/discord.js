import { contractAddress, fmtNum, headline, referralFor, solscanUrl } from '../format.js'

function embedFor(trade, variant, referralLink) {
  const isThesis = variant === 'thesis'

  const embed = {
    title: headline(trade),
    url: solscanUrl(trade.signature),
    description: isThesis ? trade.thesis?.trim() || undefined : undefined,
    color: trade.side === 'BUY' ? 0x22c55e : 0xef4444,
    fields: [
      { name: 'Side', value: trade.side, inline: true },
      { name: 'Price', value: `${fmtNum(trade.price)} ${trade.quote.symbol}`, inline: true },
      { name: 'Venue', value: trade.source, inline: true },
    ],
    timestamp: new Date(trade.timestamp).toISOString(),
  }

  // CA only on the thesis post.
  if (isThesis) embed.fields.push({ name: 'CA', value: `\`${contractAddress(trade)}\`` })
  if (referralLink) embed.footer = { text: referralLink }

  return embed
}

export async function send(settings, trade, variant = 'alert') {
  const url = settings.discord.webhookUrl
  if (!url) return { ok: false, skipped: true, reason: 'discord not configured' }

  const res = await fetch(`${url}?wait=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ embeds: [embedFor(trade, variant, referralFor(settings, 'discord'))] }),
  })

  if (!res.ok) {
    return { ok: false, reason: `discord ${res.status}: ${(await res.text()).slice(0, 200)}` }
  }
  const msg = await res.json().catch(() => ({}))
  return { ok: true, ref: msg.id ?? null }
}
