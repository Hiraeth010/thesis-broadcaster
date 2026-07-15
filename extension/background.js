const APP = 'http://localhost:3031'

// Everything observed goes to your own machine only. The app decides what is a
// thesis; the extension deliberately holds no rules of its own, so a fomo
// redesign is a one-click relearn rather than an extension update.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'observed') return

  fetch(`${APP}/api/extension/observe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(msg.payload),
  })
    .then((r) => r.json())
    .then((r) => {
      if (r?.broadcast) {
        chrome.action.setBadgeText({ text: 'sent' })
        chrome.action.setBadgeBackgroundColor({ color: '#22c55e' })
        setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000)
      }
    })
    .catch(() => {
      chrome.action.setBadgeText({ text: 'off' })
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444' })
      setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000)
    })

  sendResponse?.({ ok: true })
})
