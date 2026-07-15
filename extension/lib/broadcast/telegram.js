import {
  byline, chartUrl, contractAddress, headline, profileUrl, referralFor, solscanUrl, tokenName,
} from '../format.js'

const API = 'https://api.telegram.org'

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function bodyFor(trade, variant, referralLink, who, whoUrl) {
  const isThesis = variant === 'thesis'
  const mint = contractAddress(trade)
  const name = tokenName(trade)

  const head = `<a href="${chartUrl(mint)}">${escapeHtml(headline(trade))}</a>`
  const handle = whoUrl ? `<a href="${whoUrl}">${escapeHtml(who)}</a>` : escapeHtml(who)
  const lines = [`<b>${head}</b>${who ? ` — ${handle}` : ''}`]
  if (name) lines.push(escapeHtml(name))

  if (isThesis) {
    if (trade.thesis?.trim()) lines.push(escapeHtml(trade.thesis.trim()))
    // Telegram won't nest <a> inside <code>, and tap-to-copy beats a link for a
    // CA — so the address stays copyable and the chart gets its own link.
    lines.push(`CA: <code>${escapeHtml(mint)}</code>`)
    lines.push(`<a href="${chartUrl(mint)}">chart</a> · <a href="${solscanUrl(trade.signature)}">tx</a>`)
  } else {
    lines.push(`<a href="${solscanUrl(trade.signature)}">view tx</a>`)
  }

  if (referralLink) lines.push(escapeHtml(referralLink))
  return lines.filter(Boolean).join('\n\n')
}

async function call(botToken, method, payload) {
  const res = await fetch(`${API}/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const json = await res.json().catch(() => ({}))
  return { res, json }
}

export async function send(settings, trade, variant = 'alert') {
  const { botToken, chatId } = settings.telegram
  if (!botToken || !chatId) return { ok: false, skipped: true, reason: 'telegram not configured' }

  const { res, json } = await call(botToken, 'sendMessage', {
    chat_id: chatId,
    text: bodyFor(trade, variant, referralFor(settings, 'telegram'), byline(settings), profileUrl(settings)),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  })

  if (!res.ok || !json.ok) {
    return { ok: false, reason: `telegram ${res.status}: ${JSON.stringify(json).slice(0, 200)}` }
  }
  return { ok: true, ref: json.result?.message_id ?? null }
}

/**
 * Resolves the chat id for an existing channel: add the bot as an admin, post
 * once, then call this. Saves hunting through getUpdates by hand.
 */
export async function discoverChatId(botToken) {
  const { res, json } = await call(botToken, 'getUpdates', {})
  if (!res.ok || !json.ok) {
    return { ok: false, reason: `telegram ${res.status}: ${JSON.stringify(json).slice(0, 200)}` }
  }

  const seen = new Map()
  for (const u of json.result ?? []) {
    const chat = u.channel_post?.chat ?? u.message?.chat ?? u.my_chat_member?.chat
    if (chat?.id) seen.set(chat.id, chat.title ?? chat.username ?? chat.type)
  }
  return { ok: true, chats: [...seen].map(([id, title]) => ({ id, title })) }
}
