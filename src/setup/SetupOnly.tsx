// A fresh install: HA holds no config yet, so there is no dashboard to show.
// The editor starts on its own, and saving the first config reloads into the
// dashboard (main.tsx renders this instead of the app when the config is missing).
import { SetupEditor } from './SetupEditor';

export function SetupOnly() {
  return <SetupEditor firstRun />;
}
