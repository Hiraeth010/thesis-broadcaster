import {
  byline, chartUrl, contractAddress, headline, profileUrl, referralFor, tokenName,
} from '../format.js'

function embedFor(trade, variant, referralLink, who, whoUrl) {
  const isThesis = variant === 'thesis'
  const mint = contractAddress(trade)

  // No side, no price, no venue, no tx: a thesis is about what you hold and
  // why, not a receipt for a trade.
  const embed = {
    title: headline(trade),
    url: chartUrl(mint),
    description: isThesis ? trade.thesis?.trim() || undefined : undefined,
    color: 0x6366f1,
    // An embed author renders as a link when given a url, so the handle points
    // at your fomo profile.
    author: who ? { name: who, url: whoUrl || undefined } : undefined,
    fields: [],
    timestamp: new Date(trade.timestamp).toISOString(),
  }

  const name = tokenName(trade)
  if (name) embed.fields.push({ name: 'Token', value: name, inline: false })

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
      embeds: [
        embedFor(trade, variant, referralFor(settings, 'discord'), byline(settings), profileUrl(settings)),
      ],
    }),
  })

  if (!res.ok) {
    return { ok: false, reason: `discord ${res.status}: ${(await res.text()).slice(0, 200)}` }
  }
  const msg = await res.json().catch(() => ({}))
  return { ok: true, ref: msg.id ?? null }
}
