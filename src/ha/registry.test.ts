import { describe, expect, it, vi } from 'vitest';
import type { HassApi, RegistrySnapshot } from './api';
import { loadRegistry, registryError } from './registry';

describe('loadRegistry', () => {
  it('remembers a failure and tries again on the next call', async () => {
    const snapshot: RegistrySnapshot = { devices: [], entities: [] };
    const fetchRegistry = vi.fn().mockRejectedValueOnce({ code: 3, message: 'Connection lost' }).mockResolvedValueOnce(snapshot);
    const hass = { fetchRegistry } as unknown as HassApi;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(loadRegistry(hass, true)).rejects.toBeTruthy();
    await Promise.resolve();
    expect(registryError()).toBe('Connection lost');

    await expect(loadRegistry(hass)).resolves.toBe(snapshot); // the failed fetch wasn't cached
    await Promise.resolve();
    expect(registryError()).toBeUndefined();
    expect(fetchRegistry).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
