/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HA_URL?: string;
  readonly VITE_MOCK?: string;
  readonly VITE_PREVIEW?: string; // '1' in the deployed preview build (scripts/build-preview.sh)
}

// Embedded config for dev and mock builds; null in production, where the app
// fetches it from Home Assistant after login (see src/config/load.ts).
declare module 'virtual:dashboard-config' {
  const local: import('./config/load').StoredConfig | null;
  export default local;
}

// hls.js ships no types for its light build; it has the same API.
declare module 'hls.js/light' {
  export { default } from 'hls.js';
}
