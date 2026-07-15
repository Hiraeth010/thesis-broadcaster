import express from 'express'
import { exec } from 'node:child_process'
import { packaged, publicDir } from './paths.js'
import { config } from './config.js'
import { enabledChannels, envLocked, getSettings, maskedSettings, saveSettings } from './settings.js'
import { parseWebhookBody } from './parse.js'
import { addTrade, getTrade, listTrades, updateTrade } from './store.js'
import { sendAll } from './broadcast/index.js'
import { discoverChatId } from './broadcast/telegram.js'
import { Poller, checkRpc, resetCursor } from './poller.js'

const app = express()
app.use(express.json({ limit: '5mb' }))

// The packaged binary has no files on disk, so the dashboard is embedded as a
// SEA asset. getBuiltinModule keeps this valid in both ESM source and the
// bundled CJS output — a bare require() would not be.
if (packaged) {
  const { getAsset } = process.getBuiltinModule('node:sea')
  const html = getAsset('index.html', 'utf8')
  app.get('/', (_req, res) => res.type('html').send(html))
} else {
  app.use(express.static(publicDir))
}

function anyOk(results) {
  return Object.values(results).some((r) => r.ok)
}

async function alert(trade) {
  const results = await sendAll(trade)
  const ok = anyOk(results)
  return updateTrade(trade.id, {
    status: ok ? 'alerted' : 'failed',
    alertedAt: ok ? Date.now() : null,
    results,
  })
}

async function ingest(swap) {
  const trade = addTrade(swap)
  if (!trade) return null
  console.log(`[trade] ${trade.side} ${trade.asset.symbol} — ${trade.id}`)
  if (!getSettings().autoBroadcast) return trade
  const updated = await alert(trade)
  console.log(`[alert] ${trade.id} -> ${updated.status}`)
  return updated
}

const poller = new Poller(ingest)

app.post('/webhook', async (req, res) => {
  if (config.webhookAuth && req.get('authorization') !== config.webhookAuth) {
    return res.status(401).json({ error: 'bad auth header' })
  }

  const { wallet } = getSettings()
  if (!wallet) return res.status(400).json({ error: 'wallet not configured' })

  const swaps = parseWebhookBody(req.body, wallet)

  // Respond before broadcasting so a slow channel can't make Helius retry.
  res.json({ received: swaps.length })

  for (const swap of swaps) await ingest(swap)
})

app.get('/api/status', async (_req, res) => {
  res.json({ poller: poller.status(), channels: enabledChannels() })
})

app.post('/api/status/check-rpc', async (_req, res) => {
  try {
    res.json(await checkRpc())
  } catch (err) {
    res.json({ ok: false, reason: err.message })
  }
})

app.get('/api/trades', (_req, res) => {
  res.json({ trades: listTrades(), channels: enabledChannels(), settings: maskedSettings() })
})

app.get('/api/settings', (_req, res) => {
  res.json({ settings: maskedSettings(), channels: enabledChannels(), locked: envLocked() })
})

app.put('/api/settings', (req, res) => {
  const before = getSettings().wallet
  saveSettings(req.body ?? {})
  const after = getSettings().wallet

  // A new wallet re-baselines, so switching wallets never backfills history.
  if (after && after !== before) resetCursor(before)
  poller.start()

  res.json({ settings: maskedSettings(), channels: enabledChannels() })
})

app.post('/api/settings/telegram/discover', async (req, res) => {
  const token = req.body?.botToken || getSettings().telegram.botToken
  if (!token) return res.status(400).json({ error: 'no bot token set' })
  res.json(await discoverChatId(token))
})

app.post('/api/trades/:id/alert', async (req, res) => {
  const trade = getTrade(req.params.id)
  if (!trade) return res.status(404).json({ error: 'not found' })
  if (trade.status === 'alerted' || trade.status === 'enriched') {
    return res.status(409).json({ error: 'already broadcast' })
  }
  const updated = await alert(trade)
  res.json({ trade: updated, results: updated.results })
})

app.put('/api/trades/:id/thesis', async (req, res) => {
  const thesis = String(req.body?.thesis ?? '')
  const existing = getTrade(req.params.id)
  if (!existing) return res.status(404).json({ error: 'not found' })
  if (!thesis.trim()) return res.status(400).json({ error: 'thesis is empty' })

  // Always a fresh post, never an edit — and this is the only message that
  // carries the CA. Posting again sends another message by design.
  const trade = updateTrade(existing.id, { thesis })
  const results = await sendAll(trade, 'thesis')
  const ok = anyOk(results)

  const updated = updateTrade(trade.id, {
    status: ok ? 'enriched' : 'failed',
    enrichedAt: ok ? Date.now() : null,
    thesisResults: results,
    thesisPosts: (existing.thesisPosts ?? 0) + (ok ? 1 : 0),
  })
  res.json({ trade: updated, results })
})

app.post('/api/trades/:id/dismiss', (req, res) => {
  const trade = updateTrade(req.params.id, { status: 'dismissed' })
  if (!trade) return res.status(404).json({ error: 'not found' })
  res.json({ trade })
})

function openBrowser(url) {
  if (process.env.NO_OPEN) return
  const cmd =
    process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`
  exec(cmd, () => {})
}

app.listen(config.port, () => {
  const s = getSettings()
  const url = `http://localhost:${config.port}`
  const on = Object.entries(enabledChannels(s)).filter(([, v]) => v).map(([k]) => k)

  // ASCII only: Windows cmd renders UTF-8 arrows/dashes as mojibake, and a
  // garbled first impression reads as broken.
  console.log(`\n  thesis broadcaster is running\n`)
  console.log(`  ->  ${url}\n`)
  console.log(`  wallet:   ${s.wallet || 'not set yet - set it in the browser'}`)
  console.log(`  channels: ${on.length ? on.join(', ') : 'none yet'}`)
  console.log(`  keep this window open. close it to stop.\n`)

  if (s.wallet) poller.start()
  openBrowser(url)
})
