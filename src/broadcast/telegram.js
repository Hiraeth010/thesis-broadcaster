import { getSettings } from '../settings.js'
import { headline, solscanUrl } from './format.js'

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function bodyFor(trade, referralLink) {
  return [
    `<b>${escapeHtml(headline(trade))}</b>`,
    trade.thesis?.trim() ? escapeHtml(trade.thesis.trim()) : '',
    `<a href="${solscanUrl(trade.signature)}">view tx</a>`,
    referralLink ? escapeHtml(referralLink) : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

async function call(botToken, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const json = await res.json().catch(() => ({}))
  return { res, json }
}

export async function send(trade) {
  const { telegram, referralLink } = getSettings()
  if (!telegram.botToken || !telegram.chatId) {
    return { ok: false, skipped: true, reason: 'telegram not configured' }
  }

  const { res, json } = await call(telegram.botToken, 'sendMessage', {
    chat_id: telegram.chatId,
    text: bodyFor(trade, referralLink),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  })

  if (!res.ok || !json.ok) {
    return { ok: false, reason: `telegram ${res.status}: ${JSON.stringify(json).slice(0, 200)}` }
  }
  return { ok: true, ref: json.result?.message_id ?? null }
}

export async function edit(trade, ref) {
  const { telegram, referralLink } = getSettings()
  if (!telegram.botToken || !telegram.chatId) {
    return { ok: false, skipped: true, reason: 'telegram not configured' }
  }
  if (!ref) return { ok: false, reason: 'no telegram message ref to edit' }

  const { res, json } = await call(telegram.botToken, 'editMessageText', {
    chat_id: telegram.chatId,
    message_id: ref,
    text: bodyFor(trade, referralLink),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  })

  if (!res.ok || !json.ok) {
    return { ok: false, reason: `telegram edit ${res.status}: ${JSON.stringify(json).slice(0, 200)}` }
  }
  return { ok: true, ref }
}

/**
 * Resolves the chat id for an existing channel: add the bot as an admin, post
 * once, then call this. Saves the user hunting through getUpdates by hand.
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
