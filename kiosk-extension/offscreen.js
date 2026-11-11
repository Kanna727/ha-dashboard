// Reads the battery for the service worker: on every change and once a minute.
navigator.getBattery().then((b) => {
  const send = () => chrome.runtime.sendMessage({ battery: { level: b.level, charging: b.charging } }).catch(() => undefined);
  b.addEventListener('levelchange', send);
  b.addEventListener('chargingchange', send);
  send();
  setInterval(send, 60_000);
});
