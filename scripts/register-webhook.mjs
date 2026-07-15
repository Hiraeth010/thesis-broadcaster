import 'dotenv/config'

const API = 'https://api.helius.xyz/v0/webhooks'
const key = process.env.HELIUS_API_KEY
const wallet = process.env.WALLET_ADDRESS
const webhookURL = process.env.WEBHOOK_URL
const authHeader = process.env.WEBHOOK_AUTH ?? ''

if (!key) {
  console.error('HELIUS_API_KEY is not set')
  process.exit(1)
}

const cmd = process.argv[2] ?? 'list'

async function call(path, init) {
  const res = await fetch(`${API}${path}${path.includes('?') ? '&' : '?'}api-key=${key}`, init)
  const text = await res.text()
  if (!res.ok) throw new Error(`helius ${res.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : {}
}

if (cmd === 'list') {
  const hooks = await call('', {})
  if (!hooks.length) console.log('no webhooks registered')
  for (const h of hooks) {
    console.log(`${h.webhookID}  ${h.webhookURL}  [${h.accountAddresses.join(', ')}]`)
  }
} else if (cmd === 'register') {
  if (!wallet || !webhookURL) {
    console.error('WALLET_ADDRESS and WEBHOOK_URL must be set')
    process.exit(1)
  }
  const hook = await call('', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      webhookURL,
      transactionTypes: ['SWAP'],
      accountAddresses: [wallet],
      webhookType: 'enhanced',
      authHeader,
    }),
  })
  console.log(`registered ${hook.webhookID} -> ${webhookURL}`)
} else if (cmd === 'delete') {
  const id = process.argv[3]
  if (!id) {
    console.error('usage: npm run webhook:delete -- <webhookID>')
    process.exit(1)
  }
  await call(`/${id}`, { method: 'DELETE' })
  console.log(`deleted ${id}`)
} else {
  console.error(`unknown command: ${cmd}`)
  process.exit(1)
}
