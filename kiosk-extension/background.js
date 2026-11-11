// on: keep the display on (and wake it if it was allowed to go off).
// off: let ChromeOS turn the display off after its own idle delay.
// `last` is lost when the worker restarts; then an "on" wakes once more, which
// is harmless because the screen is on anyway.
let last;
// The battery as the offscreen page last reported it ({ level: 0–1, charging }).
// A service worker can't read it itself; the offscreen page re-reports it every
// minute, so a restarted worker has it again soon.
let battery;

// One offscreen page reads the battery (navigator.getBattery is for pages only).
async function ensureBatteryPage() {
  const open = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (open.length) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BATTERY_STATUS'],
    justification: 'Tell the wall dashboard the battery level, so Home Assistant can charge the tablet when it runs low.',
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.battery) {
    battery = msg.battery;
    return;
  }
  const canWake = typeof chrome.power.reportActivity === 'function';
  if (msg.on) {
    if (last !== true && canWake) chrome.power.reportActivity();
    chrome.power.requestKeepAwake('display');
  } else {
    chrome.power.releaseKeepAwake();
  }
  if (msg.on !== last) console.log(`Screen ${msg.on ? 'kept on' : 'allowed to turn off'} at ${new Date().toLocaleTimeString()}`);
  last = msg.on;
  ensureBatteryPage().catch((err) => console.warn('Battery page:', err));
  reply({ ready: true, canWake, battery });
});
