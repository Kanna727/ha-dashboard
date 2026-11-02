# Dashboard screen power (ChromeOS)

A tiny Chrome extension for a wall tablet running ChromeOS (or ChromeOS Flex)
that shows the dashboard in its browser. A web page can't switch a screen off,
so the dashboard decides and this extension does it with Chrome's `power` API:

- **On:** keeps the display on, and wakes it if it had gone off.
- **Off:** lets ChromeOS turn the display off after its usual idle delay. The
  tablet stays awake, so the dashboard keeps its connection and can wake it.

The dashboard's `SCREEN_POWER` setting picks when: on by day, off at night
(default 23:00–06:00) and while vacation mode is on, once nobody has been seen
in the chosen rooms for a few minutes. Someone being seen there wakes it at once.
A touch always wakes it too.

Once the screen may go off, the dashboard shows its dim night screen after a
minute without a touch and stops all its animations: ChromeOS keeps a display on
while anything large on it keeps moving, as it would for a video. The display
then goes dark after ChromeOS's own idle delay, which takes several minutes.
This works in any dashboard layout.

## Install

1. Copy this folder onto the tablet, for example into *My files → Downloads*.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load
   unpacked** and pick the folder.
3. *Settings → Device → Power → When idle → While charging*: **Turn off
   display** (not *Sleep*: the dashboard has to keep running to wake it).
4. *Settings → Security and privacy → Lock screen*: turn off **Show lock screen
   when waking from sleep**, or every wake shows the lock screen.
5. Reload the dashboard.

To check it: on `chrome://extensions`, the extension's **service worker** link
opens a console that logs each change ("Screen allowed to turn off at …").
Opening the dashboard with `?screenTest=1` added to its URL makes it treat
every hour as night with a 15 s wait, so the screen goes off after ChromeOS's
idle delay once the rooms are empty, and comes back when someone walks in.

The extension only runs on pages under `/local/dashboard/`, needs Chrome 113 or
newer (for waking the screen), and has no settings of its own. After updating
these files, click the reload icon on its card in `chrome://extensions`.
