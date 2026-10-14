/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HA_URL?: string;
  readonly VITE_MOCK?: string;
}

// Embedded config for dev and mock builds; null in production, where the app
// fetches it from Home Assistant after login (see src/config/load.ts).
declare module 'virtual:dashboard-config' {
  const local: import('./config/load').StoredConfig | null;
  export default local;
}
