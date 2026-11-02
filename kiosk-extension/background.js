// on: keep the display on (and wake it if it was allowed to go off).
// off: let ChromeOS turn the display off after its own idle delay.
// `last` is lost when the worker restarts; then an "on" wakes once more, which
// is harmless because the screen is on anyway.
let last;

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const canWake = typeof chrome.power.reportActivity === 'function';
  if (msg.on) {
    if (last !== true && canWake) chrome.power.reportActivity();
    chrome.power.requestKeepAwake('display');
  } else {
    chrome.power.releaseKeepAwake();
  }
  if (msg.on !== last) console.log(`Screen ${msg.on ? 'kept on' : 'allowed to turn off'} at ${new Date().toLocaleTimeString()}`);
  last = msg.on;
  reply({ ready: true, canWake });
});
