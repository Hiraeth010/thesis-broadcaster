import 'dotenv/config'

// Posts a synthetic Helius enhanced SWAP payload at the local server so the
// parser and dashboard can be exercised without waiting for a real trade.
const wallet = process.env.WALLET_ADDRESS
const port = process.env.PORT ?? 3031
const auth = process.env.WEBHOOK_AUTH ?? ''

if (!wallet) {
  console.error('WALLET_ADDRESS must be set')
  process.exit(1)
}

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const PUNCH = '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump'

const sig = `sample${Date.now()}`

const payload = [
  {
    signature: sig,
    timestamp: Math.floor(Date.now() / 1000),
    type: 'SWAP',
    source: 'JUPITER',
    tokenTransfers: [
      { fromUserAccount: wallet, toUserAccount: 'pool', mint: USDC, tokenAmount: 250 },
      { fromUserAccount: 'pool', toUserAccount: wallet, mint: PUNCH, tokenAmount: 41666.67 },
    ],
    nativeTransfers: [
      { fromUserAccount: wallet, toUserAccount: 'rent', amount: 2039280 },
    ],
    accountData: [],
  },
]

const res = await fetch(`http://localhost:${port}/webhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
  body: JSON.stringify(payload),
})

console.log(res.status, await res.text())
