import express from 'express'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertConfig, config, enabledChannels } from './config.js'
import { parseWebhookBody } from './parse.js'
import { addTrade, getTrade, listTrades, updateTrade } from './store.js'
import { broadcast } from './broadcast/index.js'
import { plainText } from './broadcast/format.js'

assertConfig()

const app = express()
app.use(express.json({ limit: '5mb' }))
app.use(express.static(join(dirname(fileURLToPath(import.meta.url)), 'public')))

app.post('/webhook', (req, res) => {
  if (config.webhookAuth && req.get('authorization') !== config.webhookAuth) {
    return res.status(401).json({ error: 'bad auth header' })
  }

  const swaps = parseWebhookBody(req.body, config.wallet)
  const added = swaps.map(addTrade).filter(Boolean)

  for (const trade of added) {
    console.log(`[trade] ${trade.side} ${trade.asset.symbol} — ${trade.id} (awaiting thesis)`)
  }

  res.json({ received: swaps.length, queued: added.length })
})

app.get('/api/trades', (_req, res) => {
  res.json({ trades: listTrades(), channels: enabledChannels() })
})

app.get('/api/trades/:id/preview', (req, res) => {
  const trade = getTrade(req.params.id)
  if (!trade) return res.status(404).json({ error: 'not found' })
  res.json({ preview: plainText(trade) })
})

app.put('/api/trades/:id/thesis', (req, res) => {
  const trade = updateTrade(req.params.id, { thesis: String(req.body.thesis ?? '') })
  if (!trade) return res.status(404).json({ error: 'not found' })
  res.json({ trade })
})

app.post('/api/trades/:id/broadcast', async (req, res) => {
  const trade = getTrade(req.params.id)
  if (!trade) return res.status(404).json({ error: 'not found' })
  if (trade.status === 'broadcast') {
    return res.status(409).json({ error: 'already broadcast' })
  }
  if (!trade.thesis.trim()) {
    return res.status(400).json({ error: 'write a thesis first' })
  }

  const results = await broadcast(trade, req.body.targets)
  const anySent = Object.values(results).some((r) => r.ok)

  const updated = updateTrade(trade.id, {
    status: anySent ? 'broadcast' : 'failed',
    broadcastAt: anySent ? Date.now() : null,
    results,
  })

  res.json({ trade: updated, results })
})

app.post('/api/trades/:id/skip', (req, res) => {
  const trade = updateTrade(req.params.id, { status: 'skipped' })
  if (!trade) return res.status(404).json({ error: 'not found' })
  res.json({ trade })
})

app.listen(config.port, () => {
  const on = Object.entries(enabledChannels())
    .filter(([, v]) => v)
    .map(([k]) => k)
  console.log(`thesis-broadcaster on http://localhost:${config.port}`)
  console.log(`watching wallet ${config.wallet || '(unset)'}`)
  console.log(`channels: ${on.length ? on.join(', ') : 'none configured'}`)
})
