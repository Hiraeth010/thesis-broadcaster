# thesis broadcaster

A Chrome extension. You trade on fomo, it posts to your Discord / Telegram / X.
Write your thesis on fomo and that posts too — automatically.

Nothing is hosted. No account, no server, no Node, no install. Your keys live in your
own browser.

---

## Get started

1. Download the latest `thesis-broadcaster.zip` from
   [Releases](https://github.com/Hiraeth010/thesis-broadcaster/releases) and unzip it
   (or clone this repo).
2. Chrome → `chrome://extensions` → turn on **Developer mode** → **Load unpacked** →
   pick the `extension/` folder.
3. Click the extension → **Open dashboard** → paste your wallet address, connect a
   channel, Save.

That's it. It watches your wallet and posts your trades.

## How it works

```
you trade on fomo (or anywhere on Solana)
        ↓  spotted on-chain, within a minute
an alert posts to your channels          ← automatic, no contract address
        ↓
you write a thesis on fomo
        ↓
a second post goes out: your words + the CA
```

**The contract address only ever appears on the thesis post.** The alert says a trade
happened; the thesis is the one that invites people to act on it.

Every thesis is a **new message**, never an edit. Post again and it sends another —
useful when you're adding to a position or updating a call.

Don't want the fomo hook? You can write the thesis in the dashboard instead. Prefer to
approve everything by hand? Turn off auto-broadcast in Setup.

## Connecting your channels

**Discord** — Server Settings → Integrations → Webhooks → New Webhook → Copy URL.

**Telegram** — message [@BotFather](https://t.me/botfather), send `/newbot`, copy the
token. Add the bot to your channel **as an admin**, post any message there, then hit
**Find my channels** and it fills in the chat id for you.

**X — optional, and it costs money.** X killed its free API tier in February 2026. It's
[pay-per-use](https://docs.x.com/x-api/getting-started/pricing): **$0.015 per post, or
$0.200 if the post contains a link.** So your referral link is **off for X by default**
and on everywhere else — same post, same CA, no link, ~13× cheaper. You bring your own
app, so the bill is yours. That's also why there's no "log in with X": OAuth would put
every user's posts on *our* bill.

Connect one or all three. Anything you leave blank is skipped.

## Reading your thesis off fomo

This part is optional, and you should know what it is.

**fomo's terms prohibit automated access.** The content script reads the requests your
own fomo tab already makes, which is automated access to your own account — an account
holding your money. Nobody has been banned for it that I know of, but nobody has tested
it either, and that isn't a safety guarantee. If you hand this to other people, tell
them.

What it does and doesn't touch:

- Request **headers are dropped entirely** — your session token and cookies never leave
  the page. Only JSON bodies are inspected.
- It never reads other users' data, the feed, or anything you didn't write.
- Nothing is forwarded until you point at it once and say "this is my thesis".

**Teaching it (once):** post a thesis on fomo → click the extension → click *"This is
my thesis"* next to your text. Done.

Nothing about fomo's API is hardcoded, because nothing can be — their thesis endpoint
isn't in the public bundle (all 221 chunks were checked; only `/v2/users/*` is exposed,
the rest is built behind login). So it learns from your own traffic. A fomo redesign is
a **relearn** (Forget → post once → pick again), not a broken extension.

## Common questions

**Do I need to leave anything running?** Just Chrome. There's no app and no service.

**Does it work when Chrome is closed?** No — that's the trade for having no installer,
no binary and no OS-level background service. Trades made while Chrome is shut are
caught up next time you open it.

**Will it post my old trades?** No. The first time it sees your wallet it marks the
spot and only watches from then on.

**Do I need an API key?** No. It defaults to a public Solana node that works fine. A
free key from [helius.dev](https://helius.dev) makes it faster and more reliable if you
trade a lot — Setup → Connection.

**I set a custom RPC and get `403 Access forbidden`.** That endpoint refuses browser
extensions. `api.mainnet-beta.solana.com` is the usual culprit — it 403s every browser
origin, so it can never work here. Clear the custom RPC field to fall back to the
default, or use a Helius key.

**Where are my keys?** `chrome.storage.local`, in this browser, on this machine. Not
synced. The dashboard never shows a saved key back to you — it just says "configured".

**Does it connect to my fomo account?** No. It never asks for your fomo login and can't
move your money. It reads public chain data, plus (optionally) the thesis you typed in
your own tab.

---

## For developers

### Architecture

```
fomo tab
  hook.js    (MAIN world)      wraps fetch/XHR, drops headers, keeps JSON bodies
  relay.js   (ISOLATED world)  bridges to chrome.runtime
        ↓
background.js  (service worker, ES module)
  lib/poller.js    chrome.alarms -> RPC -> parse -> broadcast
  lib/parse.js     swaps from net balance deltas
  lib/learn.js     finds the thesis field, matches it to a trade
  lib/broadcast/   discord / telegram / x
  lib/settings.js  chrome.storage.local
```

The two content-script worlds exist because a MAIN-world script can hook the page's
`fetch` but can't reach `chrome.runtime`, and an ISOLATED-world script is the reverse.

**No module holds state.** An MV3 service worker is torn down between alarms, so
everything lives in `chrome.storage` and every function takes `settings` as an argument
rather than reading a global.

### The parser

`lib/parse.js` derives swaps from **net wallet balance deltas**, not per-router
adapters — Jupiter, Relay, whatever fomo routes through this month all work unchanged.

- Negative delta sold, positive bought; SOL/USDC/USDT are the quote side.
- Quote-to-quote (SOL→USDC) ignored — no asset leg worth a thesis.
- Native SOL under 0.001 ignored, so ATA rent (~0.002 SOL) isn't read as the quote leg.
- Replayed signatures dedupe.

### Cursor safety

The poller's cursor only advances past signatures it actually dealt with. A
**rate-limited** fetch is retriable: the walk stops and the next poll resumes there.
Only a permanently unreadable tx ("not found" on a non-archive node) is skipped.
Getting this wrong meant silently dropping every trade while looking healthy.

### Icons

```bash
node tools/make-icons.mjs   # regenerates extension/icons/*.png
```

Generated, not drawn — `tools/make-icons.mjs` is a small PNG encoder (node's zlib is
the only thing it needs) that renders the mark at each size with supersampled edges.
The tile is coloured rather than dark or light, because a dark icon vanishes on a dark
Chrome toolbar and a light one vanishes on a light one.

### Tests

```bash
npm test                      # all suites
node tests/manifest.test.mjs  # manifest, icons, module graph
```

- `background.test.mjs` loads the **real service worker** with a stubbed `chrome` and
  stubbed network, then drives it as Chrome would: baseline → swap → alert → thesis →
  dedupe, plus secret round-trip safety.
- `oauth1.test.mjs` pins the hand-rolled OAuth 1.0a signing to
  [X's own published vector](https://developer.x.com/en/docs/authentication/oauth-1-0a/creating-a-signature).
  `twitter-api-v2` is Node-only, so signing is done with Web Crypto — and hand-rolled
  crypto is exactly where silent bugs live.
- `parse.test.mjs`, `learn.test.mjs` — parser and thesis-detection edge cases.

## Status

**Verified:** 44 checks across 4 suites, including the real service worker driven
end to end. The fetch/XHR hook was verified in a live browser (captures both, resolves
relative URLs, ignores GETs, doesn't break the page).

**Not verified:** none of it has been loaded into Chrome against a live fomo session.
The payload shape the hook will meet is unknown — which is exactly why it learns
instead of guessing. X has never posted for real; its signing matches X's vector, but
that isn't the same as X accepting it. Telegram has never run against a live bot.

Expect the first run to need a round of fixing.

### History

Up to v0.3.0 this was a Node app with standalone binaries and OS-level autostart
(Task Scheduler / LaunchAgent / systemd). That's all in git history. It was dropped for
the extension: no code signing, no installer, no 90MB binary, no autostart machinery —
at the cost of only running while Chrome is open, which the thesis feature required
anyway.
