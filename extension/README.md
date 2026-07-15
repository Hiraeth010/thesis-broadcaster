# thesis broadcaster — browser extension

Post a thesis on fomo, and it goes out to your Discord / Telegram / X automatically.

Without this, you write the thesis in the dashboard at `localhost:3031`. With it, you
write it once, in fomo, where you were already writing it.

## Read this before installing

**fomo's terms prohibit automated access.** This extension is automated access to your
own account. Your account could be suspended for it, and that account holds your money.
Nobody has been banned for this that I know of — but nobody has tested it either, and
"nobody's been caught yet" is not a safety guarantee.

That risk is yours to take. If you hand this to other people, tell them plainly rather
than letting them find out.

## What it does and doesn't touch

It reads **the requests your own fomo tab is already making** — nothing more.

- It never sends your session token, cookies, or auth headers anywhere. Request
  **headers are dropped entirely**; only JSON bodies are looked at.
- It talks to **one place: `localhost:3031`** — your own machine. No server of ours,
  no third party.
- It does not read other users' data, the feed, or anything you didn't write.
- It only ever forwards a payload once you've pointed at it and said "this is my
  thesis".

## Install

1. Run thesis broadcaster (it must be running — the extension talks to it).
2. Chrome → `chrome://extensions` → turn on **Developer mode**.
3. **Load unpacked** → pick this `extension/` folder.

## Teach it (once)

fomo has no public API and their thesis endpoint isn't in the public bundle, so nothing
is hardcoded — it learns from your own traffic instead:

1. Open fomo and post a thesis as normal.
2. Click the extension icon.
3. It shows what it saw. Click **"This is my thesis"** next to your text.

Done. From then on, theses broadcast automatically.

Because it's learned rather than hardcoded, a fomo redesign is a **relearn** (click
Forget, post once, pick again) — not a broken extension waiting on an update.

## How the pieces fit

```
fomo tab
  hook.js    (page world)      wraps fetch/XHR, sees requests, drops headers
  relay.js   (isolated world)  bridges to the extension
  background.js                forwards to localhost:3031
       ↓
thesis broadcaster
  src/extension.js   finds the prose field, matches it to your trade, broadcasts
```

The split exists because a page-world script can hook `fetch` but can't reach
`chrome.runtime`, and an isolated-world script can reach `chrome.runtime` but can't
hook the page's `fetch`.

## Status

**Verified:** the learn-and-broadcast pipeline, end to end, against simulated fomo
traffic — noise is ignored, a thesis payload is surfaced, ids are generalised out of
the URL, nothing broadcasts until you teach it, a new thesis then auto-broadcasts, the
same thesis doesn't double-post, and unrelated endpoints stay ignored. The fetch/XHR
hook was verified in a real browser (it captures both, resolves relative URLs, ignores
GETs, doesn't break the page).

**Not verified:** any of it against the real fomo. I can't log in to fomo, so the
payload shape it will meet is unknown — which is exactly why it learns instead of
guessing. The extension has not been loaded into Chrome against a live fomo session.

Expect the first run to need a round of fixing. If the popup shows nothing after you
post a thesis, fomo probably isn't sending a JSON body the hook recognises — say so and
it's a small change.
