// Runs in the dashboard page: passes its screen messages to the service worker
// and posts the answer back so the page knows the extension is there.
window.addEventListener('message', (e) => {
  if (e.source !== window || e.data?.source !== 'ha-dashboard' || e.data.type !== 'screen') return;
  chrome.runtime.sendMessage({ on: !!e.data.on }, (reply) => {
    if (chrome.runtime.lastError || !reply) return;
    window.postMessage({ source: 'ha-dashboard-screen', ...reply }, window.location.origin);
  });
});
