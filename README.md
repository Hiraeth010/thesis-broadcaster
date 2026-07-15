# thesis broadcaster

Post your trades to Discord, Telegram and X automatically — and add your thesis after.

Runs on your own computer. Your keys never leave it.

---

## Get started

**1. Install Node.js** (once) — [nodejs.org](https://nodejs.org), click the big green LTS button.

**2. Start it**

- **Windows** — double-click `start.bat`
- **Mac / Linux** — double-click `start.sh` (or `./start.sh` in a terminal)

The first run installs things and takes a minute. Your browser opens automatically.

**3. Fill in the Setup box**

Paste your wallet address. Connect a channel. That's it — it starts watching.

There's nothing to host, no account to make, no port to open.

---

## Connecting your channels

**Discord** — Server Settings → Integrations → Webhooks → New Webhook → Copy URL. Paste it in.

**Telegram** — message [@BotFather](https://t.me/botfather), send `/newbot`, copy the token.
Add your bot to your channel **as an admin**, post any message there, then hit
**Find my channels** and it fills in the rest.

**X** — needs your own app from [developer.x.com](https://developer.x.com). More effort, and
X changes their free limits often. Discord and Telegram are free and take a minute;
start there.

You can connect one or all three. Anything you leave blank is simply skipped.

---

## How it works

```
you make a trade  (on fomo, or anywhere else on Solana)
        ↓
  we spot it on-chain, within ~15 seconds
        ↓
  a post goes out to your channels          ← automatic, you do nothing
        ↓
  you write your thesis when you feel like it
        ↓
  the post updates itself with it           ← same post, no spam
```

On X it posts your thesis as a reply instead, because X has no edit button.

Prefer to check before anything goes out? Turn off **auto-broadcast** in Setup and
nothing posts until you write a thesis and press the button.

---

## Common questions

**Do I need to leave it running?** Yes — it watches while it's open. Close the window
to stop.

**Will it post my old trades?** No. The first time it sees your wallet it marks the
spot and only watches from then on.

**Do I need an API key?** No, but it helps. Without one it uses a free public Solana
node that gets rate-limited, and you may miss trades. A free key from
[helius.dev](https://helius.dev) takes a minute and makes it reliable. Setup →
Connection.

**Where are my keys stored?** In `data/config.json`, on your computer. Nothing is sent
anywhere except the channels you connect. The app never shows your keys back to you
in the browser — once saved, a field just says "configured".

**Does this connect to my fomo account?** No. It never touches fomo, never asks for
your fomo login, and can't move your money. It only reads public blockchain data.

---

## For developers

### Why it doesn't touch fomo

fomo has **no public API** — every `/api/*` path returns the SPA shell, `api.`/`docs.`
don't resolve, real data sits behind `*.prod-edge.fomo.family` under Privy auth, and
their ToS prohibits automated access.

So this reads **the chain**, which is public, and the thesis text originates with you.
Nothing to break, no ToS exposure, and it works identically on Axiom, Phantom, or
anything else that swaps on Solana. If fomo ever ships a real endpoint, it slots in as
an extra trigger source without changing the architecture.

### Why polling, not webhooks

Webhooks need a publicly reachable URL. Normal people don't have one, and "run a
tunnel" is worse than the problem. `src/poller.js` polls `getSignaturesForAddress`
instead, so it works from any laptop behind NAT with no inbound anything.

The `POST /webhook` endpoint still exists for anyone who wants to point Helius at it:

```bash
npm run webhook:register   # needs HELIUS_API_KEY + WEBHOOK_URL in .env
```

### The parser

`src/parse.js` derives swaps from **net wallet balance deltas**, not per-router
adapters — Jupiter, Relay, whatever fomo routes through this month all work unchanged.
Two input shapes feed one core: Helius enhanced payloads (webhook) and raw
`getTransaction` (poller, any RPC, no key required).

- Negative delta sold, positive bought; SOL/USDC/USDT are the quote side.
- Quote-to-quote (SOL→USDC) ignored — no asset leg worth a thesis.
- Native SOL under 0.001 ignored, so ATA rent (~0.002 SOL) isn't read as the quote leg.
- Replayed signatures dedupe.

### Cursor safety

The poller's cursor only advances past signatures it actually dealt with. A
**rate-limited** fetch is retriable: the walk stops and the next poll resumes there.
Only a permanently unreadable tx (non-archive node, "not found") is skipped. Getting
this wrong meant silently dropping every trade while looking healthy — see the tests.

### Config

`.env` takes precedence over the Setup UI, so dotfile users are unaffected. Anything
set in `.env` shows as locked in the UI.

### Testing without a real trade

```bash
npm run dev
node scripts/sample-webhook.mjs buy
node scripts/sample-webhook.mjs sell
```

---

## Status

**Verified:** setup → save → swap → instant alert → thesis → in-place edit, against a
mock receiver. Parser validated against **real mainnet blocks**. Cursor logic tested
across four RPC failure modes (healthy / rate-limited / not-found / partial). Plus
auto-broadcast toggle, empty-thesis rejection, dedupe, quote-to-quote filtering,
ATA-rent dust, and secret round-trip safety.

**Not verified:** Telegram and X are implemented but have never run against live
credentials. Treat as untested until you point real ones at them.

**Not done:** thesis templates, a bundled Node runtime (still requires installing
Node), and the optional browser extension for reading a thesis written in fomo's own
UI (ToS-gray — read the discussion before shipping that).
