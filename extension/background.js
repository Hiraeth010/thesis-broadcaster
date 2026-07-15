import { loadSettings, saveSettings, publicSettings, enabledChannels } from './lib/settings.js'
import { addTrade, getTrade, listTrades, updateTrade, setStatus, getStatus, clearCursor } from './lib/store.js'
import { poll, checkRpc, rpcUrl, redactRpc } from './lib/poller.js'
import { sendAll, anyOk } from './lib/broadcast/index.js'
import { discoverChatId } from './lib/broadcast/telegram.js'
import * as learn from './lib/learn.js'

const ALARM = 'poll'

// chrome.alarms has a 1-minute floor, and the service worker is torn down
// between firings — so all state lives in chrome.storage, never in memory.
async function scheduleAlarm() {
  const { pollMinutes } = await loadSettings()
  await chrome.alarms.create(ALARM, { periodInMinutes: Math.max(1, Number(pollMinutes) || 1) })
}

chrome.runtime.onInstalled.addListener(scheduleAlarm)
chrome.runtime.onStartup.addListener(scheduleAlarm)

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return
  await runPoll()
})

async function badge(text, color) {
  await chrome.action.setBadgeText({ text })
  if (color) await chrome.action.setBadgeBackgroundColor({ color })
  if (text) setTimeout(() => chrome.action.setBadgeText({ text: '' }), 5000)
}

async function alert(settings, trade) {
  const results = await sendAll(settings, trade, 'alert')
  const ok = anyOk(results)
  return updateTrade(trade.id, {
    status: ok ? 'alerted' : 'failed',
    alertedAt: ok ? Date.now() : null,
    results,
  })
}

async function ingest(settings, swap) {
  const trade = await addTrade(swap)
  if (!trade) return null
  console.log(`[trade] ${trade.side} ${trade.asset.symbol} — ${trade.id}`)
  if (!settings.autoBroadcast) return trade
  const updated = await alert(settings, trade)
  console.log(`[alert] ${trade.id} -> ${updated.status}`)
  await badge('new', '#22c55e')
  return updated
}

async function runPoll() {
  const settings = await loadSettings()
  if (!settings.wallet) return
  try {
    await poll(settings, (swap) => ingest(settings, swap))
  } catch (err) {
    console.log(`[poll] ${err.message}`)
    await setStatus({ lastError: err.message })
    await badge('!', '#ef4444')
  }
}

/**
 * Matches a thesis captured from fomo to the trade it belongs to: same mint if
 * the payload carried one, otherwise the most recent trade still without a
 * thesis. Returns null rather than guessing at an unrelated trade.
 */
async function tradeForThesis(mint) {
  const trades = (await listTrades()).filter((t) => t.status !== 'dismissed')
  if (mint) {
    const byMint = trades.find((t) => t.asset.mint === mint)
    if (byMint) return byMint
  }
  return trades.find((t) => !t.thesis?.trim()) ?? null
}

async function postThesis(settings, trade, thesis) {
  const updated = await updateTrade(trade.id, { thesis })
  const results = await sendAll(settings, updated, 'thesis')
  const ok = anyOk(results)
  await updateTrade(trade.id, {
    status: ok ? 'enriched' : 'failed',
    enrichedAt: ok ? Date.now() : null,
    thesisResults: results,
    thesisPosts: (trade.thesisPosts ?? 0) + (ok ? 1 : 0),
  })
  return { ok, results }
}

async function onObserved(payload) {
  const settings = await loadSettings()
  await learn.record(payload)

  const hit = learn.match(settings.learn, payload)
  if (!hit) return { observed: true, broadcast: false }

  const trade = await tradeForThesis(hit.mint)
  if (!trade) return { observed: true, broadcast: false, reason: 'no matching trade' }
  if (trade.thesis?.trim() === hit.thesis) {
    return { observed: true, broadcast: false, reason: 'already posted' }
  }

  const { ok } = await postThesis(settings, trade, hit.thesis)
  console.log(`[ext] thesis from fomo -> ${trade.id} -> ${ok ? 'broadcast' : 'failed'}`)
  await badge(ok ? 'sent' : 'fail', ok ? '#22c55e' : '#ef4444')
  return { observed: true, broadcast: ok }
}

// One message router for the hook, the popup and the options page.
const handlers = {
  observed: ({ payload }) => onObserved(payload),

  getState: async () => {
    const settings = await loadSettings()
    return {
      settings: await publicSettings(),
      channels: enabledChannels(settings),
      status: { ...(await getStatus()), rpc: redactRpc(rpcUrl(settings)) },
      trades: await listTrades(),
      candidates: await learn.listCandidates(),
    }
  },

  saveSettings: async ({ patch }) => {
    const before = (await loadSettings()).wallet
    await saveSettings(patch)
    const after = (await loadSettings()).wallet
    // A new wallet re-baselines, so switching wallets never backfills history.
    if (after && after !== before) await clearCursor(before)
    await scheduleAlarm()
    return { settings: await publicSettings(), channels: enabledChannels(await loadSettings()) }
  },

  pollNow: async () => {
    await runPoll()
    return { status: await getStatus() }
  },

  checkRpc: async () => {
    try {
      return await checkRpc(await loadSettings())
    } catch (err) {
      return { ok: false, reason: err.message }
    }
  },

  discoverChat: async ({ botToken }) => {
    const settings = await loadSettings()
    return discoverChatId(botToken || settings.telegram.botToken)
  },

  learn: async ({ pattern, field }) => {
    await saveSettings({ learn: { pattern, field, learnedAt: Date.now() } })
    return { learn: (await loadSettings()).learn }
  },

  forget: async () => {
    await saveSettings({ learn: { pattern: '', field: '', learnedAt: 0 } })
    await learn.clearCandidates()
    return { learn: (await loadSettings()).learn }
  },

  postThesis: async ({ id, thesis }) => {
    const settings = await loadSettings()
    const trade = await getTrade(id)
    if (!trade) return { error: 'not found' }
    if (!thesis?.trim()) return { error: 'thesis is empty' }
    return postThesis(settings, trade, thesis.trim())
  },

  dismiss: async ({ id }) => ({ trade: await updateTrade(id, { status: 'dismissed' }) }),
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type]
  if (!handler) return
  // Returning true keeps the channel open for the async reply.
  handler(msg).then(sendResponse, (err) => sendResponse({ error: err.message }))
  return true
})
