import { config } from '../config.js'
import { headline, plainText, solscanUrl } from './format.js'

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function send(trade) {
  const { botToken, chatId } = config.telegram
  if (!botToken || !chatId) {
    return { ok: false, skipped: true, reason: 'TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set' }
  }

  const body = [
    `<b>${escapeHtml(headline(trade))}</b>`,
    trade.thesis.trim() ? escapeHtml(trade.thesis.trim()) : '',
    `<a href="${solscanUrl(trade.signature)}">view tx</a>`,
    config.referralLink ? escapeHtml(config.referralLink) : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: body,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.ok) {
    return { ok: false, reason: `telegram ${res.status}: ${JSON.stringify(json).slice(0, 200)}` }
  }
  return { ok: true }
}

export { plainText }
