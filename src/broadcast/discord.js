import { getSettings } from '../settings.js'
import { fmtNum, headline, solscanUrl } from './format.js'

function embedFor(trade, referralLink) {
  const embed = {
    title: headline(trade),
    url: solscanUrl(trade.signature),
    description: trade.thesis?.trim() || undefined,
    color: trade.side === 'BUY' ? 0x22c55e : 0xef4444,
    fields: [
      { name: 'Side', value: trade.side, inline: true },
      { name: 'Price', value: `${fmtNum(trade.price)} ${trade.quote.symbol}`, inline: true },
      { name: 'Venue', value: trade.source, inline: true },
    ],
    timestamp: new Date(trade.timestamp).toISOString(),
  }
  if (referralLink) embed.footer = { text: referralLink }
  return embed
}

export async function send(trade) {
  const { discord, referralLink } = getSettings()
  if (!discord.webhookUrl) return { ok: false, skipped: true, reason: 'discord not configured' }

  // wait=true makes Discord return the created message so it can be edited
  // later when the thesis arrives.
  const res = await fetch(`${discord.webhookUrl}?wait=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ embeds: [embedFor(trade, referralLink)] }),
  })

  if (!res.ok) {
    return { ok: false, reason: `discord ${res.status}: ${(await res.text()).slice(0, 200)}` }
  }
  const msg = await res.json().catch(() => ({}))
  return { ok: true, ref: msg.id ?? null }
}

export async function edit(trade, ref) {
  const { discord, referralLink } = getSettings()
  if (!discord.webhookUrl) return { ok: false, skipped: true, reason: 'discord not configured' }
  if (!ref) return { ok: false, reason: 'no discord message ref to edit' }

  const res = await fetch(`${discord.webhookUrl}/messages/${ref}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ embeds: [embedFor(trade, referralLink)] }),
  })

  if (!res.ok) {
    return { ok: false, reason: `discord edit ${res.status}: ${(await res.text()).slice(0, 200)}` }
  }
  return { ok: true, ref }
}
