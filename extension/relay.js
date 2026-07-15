// Isolated world: the page-world hook can't reach chrome.runtime, so this
// bridges its postMessage traffic to the service worker.
window.addEventListener('message', (event) => {
  if (event.source !== window) return
  if (event.data?.source !== 'thesis-broadcaster') return
  try {
    chrome.runtime.sendMessage({ type: 'observed', payload: event.data.payload })
  } catch {
    // service worker asleep or extension reloaded — nothing to do
  }
})
