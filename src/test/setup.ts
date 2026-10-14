// Runs before each test file: modules that read the per-home config at load
// (src/config/entities.ts) get the example home, as in the mock build. Tests
// run in plain Node, so `window` is just the global object.
import example from '../../config/dashboard.config.example';

(globalThis as { window?: unknown }).window ??= globalThis;
window.__DASHBOARD_CONFIG__ = example;
window.__DASHBOARD_CONFIG_HASH__ = 'test';
