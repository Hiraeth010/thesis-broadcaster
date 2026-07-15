import { config } from '../src/config.js'
import { getSettings } from '../src/settings.js'

// Posts a synthetic Helius enhanced SWAP payload at the local server so the
// parser and broadcast path can be exercised without waiting for a real trade.
const { wallet } = getSettings()
if (!wallet) {
  console.error('No wallet configured — set it in the dashboard or WALLET_ADDRESS in .env')
  process.exit(1)
}

const side = process.argv[2] ?? 'buy'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const PUNCH = '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump'

const legs =
  side === 'sell'
    ? [
        { fromUserAccount: wallet, toUserAccount: 'pool', mint: PUNCH, tokenAmount: 41666.67 },
        { fromUserAccount: 'pool', toUserAccount: wallet, mint: USDC, tokenAmount: 410 },
      ]
    : [
        { fromUserAccount: wallet, toUserAccount: 'pool', mint: USDC, tokenAmount: 250 },
        { fromUserAccount: 'pool', toUserAccount: wallet, mint: PUNCH, tokenAmount: 41666.67 },
      ]

const payload = [
  {
    signature: `${side}${Date.now()}`,
    timestamp: Math.floor(Date.now() / 1000),
    type: 'SWAP',
    source: side === 'sell' ? 'RELAY' : 'JUPITER',
    tokenTransfers: legs,
    // ATA rent — must not be mistaken for the quote leg.
    nativeTransfers: [{ fromUserAccount: wallet, toUserAccount: 'rent', amount: 2039280 }],
  },
]

const res = await fetch(`http://localhost:${config.port}/webhook`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(config.webhookAuth ? { authorization: config.webhookAuth } : {}),
  },
  body: JSON.stringify(payload),
})

console.log(res.status, await res.text())
