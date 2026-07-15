import { contractAddress, headline, referralFor, solscanUrl } from '../format.js'

const API = 'https://api.telegram.org'

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function bodyFor(trade, variant, referralLink) {
  const isThesis = variant === 'thesis'
  const lines = [`<b>${escapeHtml(headline(trade))}</b>`]

  if (isThesis) {
    if (trade.thesis?.trim()) lines.push(escapeHtml(trade.thesis.trim()))
    // <code> makes the CA tap-to-copy in Telegram.
    lines.push(`CA: <code>${escapeHtml(contractAddress(trade))}</code>`)
  }

  lines.push(`<a href="${solscanUrl(trade.signature)}">view tx</a>`)
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
    text: bodyFor(trade, variant, referralFor(settings, 'telegram')),
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
