import { loadSettings, saveSettings, publicSettings, enabledChannels, KNOWN_FOMO_THESIS } from './lib/settings.js'
import { addTrade, getTrade, listTrades, updateTrade, setStatus, getStatus, clearCursor } from './lib/store.js'
import { poll, checkRpc, rpcUrl, redactRpc } from './lib/poller.js'
import { resolveToken } from './lib/tokens.js'
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
  const results = await sendAll(settings, await withToken(trade), 'alert')
  const ok = anyOk(results)
  return updateTrade(trade.id, {
    status: ok ? 'alerted' : 'failed',
    alertedAt: ok ? Date.now() : null,
    results,
  })
}

/**
 * Trades stored before token resolution existed (or resolved while an API was
 * down) kept the shortened mint as their symbol. Heal them before posting,
 * otherwise an old trade broadcasts as "Cq3Y…kUzG" forever.
 */
async function withToken(trade) {
  if (trade.asset.symbol && !trade.asset.symbol.includes('…')) return trade
  const token = await resolveToken(trade.asset.mint)
  if (token.symbol.includes('…')) return trade // still unknown; nothing gained
  return (
    (await updateTrade(trade.id, {
      asset: { ...trade.asset, symbol: token.symbol, name: token.name },
    })) ?? trade
  )
}

async function ingest(settings, swap) {
  // Resolved once, at ingest, so the stored trade carries a real name and every
  // later post is consistent even if the lookup starts failing.
  const token = await resolveToken(swap.asset.mint)
  swap.asset.symbol = token.symbol
  swap.asset.name = token.name

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
  // The most recent trade, even if it already has a thesis: a thesis you just
  // wrote is about the trade you just made, and revising one is normal. Only
  // taking untouched trades meant a second thesis silently attached to some
  // older trade, or to nothing at all. Identical text is deduped by the caller.
  return trades[0] ?? null
}

async function postThesis(settings, trade, thesis) {
  const healed = await withToken(trade)
  const updated = await updateTrade(healed.id, { thesis })
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
  const entry = await learn.record(payload)
  console.log(
    `[ext] observed ${payload.method} ${entry.pattern}` +
      ` | guesses: ${entry.fields.map((f) => f.path).join(',') || 'none'}` +
      ` | pickable: ${(entry.allFields ?? []).map((f) => f.path).join(',') || 'none'}`
  )

  // Every outcome is logged. A thesis that doesn't go out used to leave no
  // trace at all, which made it impossible to tell "not taught yet" from
  // "taught but nothing matched" from "sent, and Discord rejected it".
  const hit = learn.match(settings.learn, payload)
  if (!hit) {
    if (settings.learn?.pattern && learn.urlPattern(payload.url) === settings.learn.pattern) {
      console.log(
        `[ext] matched ${settings.learn.pattern} but field "${settings.learn.field}" wasn't prose — got:`,
        JSON.stringify(payload.body).slice(0, 200)
      )
    }
    return { observed: true, broadcast: false }
  }

  const trade = await tradeForThesis(hit.mint)
  if (!trade) {
    console.log('[ext] thesis seen, but there are no trades to attach it to yet')
    return { observed: true, broadcast: false, reason: 'no matching trade' }
  }
  if (trade.thesis?.trim() === hit.thesis) {
    console.log(`[ext] thesis already posted for ${trade.id}, skipping`)
    return { observed: true, broadcast: false, reason: 'already posted' }
  }

  const { ok, results } = await postThesis(settings, trade, hit.thesis)
  console.log(`[ext] thesis from fomo -> ${trade.id} (${trade.asset.symbol}) -> ${ok ? 'broadcast' : 'FAILED'}`)
  if (!ok) console.log('[ext] channel results:', JSON.stringify(results))
  await badge(ok ? 'sent' : 'fail', ok ? '#22c55e' : '#ef4444')
  return { observed: true, broadcast: ok, results }
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
      seen: await learn.getSeen(),
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
    const settings = await loadSettings()

    // Broadcast the very thesis that was just pointed at. Matching only fires
    // on the NEXT request, so without this the thesis used to teach it is
    // silently dropped and the first one you ever write never goes out.
    let broadcast = false
    const picked = (await learn.listCandidates()).find(
      (c) => c.pattern === pattern && c.fields.some((f) => f.path === field)
    )
    if (picked) {
      const thesis = picked.fields.find((f) => f.path === field)?.value?.trim()
      const trade = await tradeForThesis(picked.mint)
      if (thesis && trade && trade.thesis?.trim() !== thesis) {
        const r = await postThesis(settings, trade, thesis)
        broadcast = r.ok
        console.log(`[ext] learned, posting that thesis now -> ${trade.id} -> ${r.ok ? 'sent' : 'failed'}`)
      }
    }

    return { learn: settings.learn, broadcast }
  },

  // Resets to fomo's known endpoint rather than to nothing — "it stopped
  // working" almost always means a bad custom pick, not that the default is
  // wrong. Picking something else still overrides it.
  forget: async () => {
    await saveSettings({ learn: { ...KNOWN_FOMO_THESIS, learnedAt: 0 } })
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
