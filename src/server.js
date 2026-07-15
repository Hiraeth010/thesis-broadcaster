import express from 'express'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'
import { enabledChannels, envLocked, getSettings, maskedSettings, saveSettings } from './settings.js'
import { parseWebhookBody } from './parse.js'
import { addTrade, getTrade, listTrades, updateTrade } from './store.js'
import { sendAll, editAll } from './broadcast/index.js'
import { discoverChatId } from './broadcast/telegram.js'

const app = express()
app.use(express.json({ limit: '5mb' }))
app.use(express.static(join(dirname(fileURLToPath(import.meta.url)), 'public')))

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

app.post('/webhook', async (req, res) => {
  if (config.webhookAuth && req.get('authorization') !== config.webhookAuth) {
    return res.status(401).json({ error: 'bad auth header' })
  }

  const { wallet, autoBroadcast } = getSettings()
  if (!wallet) return res.status(400).json({ error: 'wallet not configured' })

  const swaps = parseWebhookBody(req.body, wallet)
  const added = swaps.map(addTrade).filter(Boolean)

  // Respond before broadcasting so a slow channel can't make Helius retry.
  res.json({ received: swaps.length, queued: added.length })

  for (const trade of added) {
    console.log(`[trade] ${trade.side} ${trade.asset.symbol} — ${trade.id}`)
    if (!autoBroadcast) continue
    const updated = await alert(trade)
    console.log(`[alert] ${trade.id} -> ${updated.status}`)
  }
})

app.get('/api/trades', (_req, res) => {
  res.json({ trades: listTrades(), channels: enabledChannels(), settings: maskedSettings() })
})

app.get('/api/settings', (_req, res) => {
  res.json({ settings: maskedSettings(), channels: enabledChannels(), locked: envLocked() })
})

app.put('/api/settings', (req, res) => {
  saveSettings(req.body ?? {})
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

  const trade = updateTrade(existing.id, { thesis })
  const results = trade.status === 'queued' ? await sendAll(trade) : await editAll(trade)
  const ok = anyOk(results)

  const updated = updateTrade(trade.id, {
    status: ok ? 'enriched' : 'failed',
    alertedAt: trade.alertedAt ?? (ok ? Date.now() : null),
    enrichedAt: ok ? Date.now() : null,
    results,
  })
  res.json({ trade: updated, results })
})

app.post('/api/trades/:id/dismiss', (req, res) => {
  const trade = updateTrade(req.params.id, { status: 'dismissed' })
  if (!trade) return res.status(404).json({ error: 'not found' })
  res.json({ trade })
})

app.listen(config.port, () => {
  const s = getSettings()
  const on = Object.entries(enabledChannels(s)).filter(([, v]) => v).map(([k]) => k)
  console.log(`thesis-broadcaster on http://localhost:${config.port}`)
  console.log(`wallet: ${s.wallet || '(unset — open the dashboard to configure)'}`)
  console.log(`channels: ${on.length ? on.join(', ') : 'none'} · auto-broadcast: ${s.autoBroadcast}`)
})
