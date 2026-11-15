import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import example from '../../config/dashboard.config.example';
import { configHash, sha256Hex } from './hash';

const node = (s: string) => createHash('sha256').update(s).digest('hex');

describe('sha256Hex', () => {
  it('matches the known test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches Node on lengths around the block boundaries and on non-ASCII text', () => {
    for (const n of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) {
      const s = 'x'.repeat(n);
      expect(sha256Hex(s)).toBe(node(s));
    }
    expect(sha256Hex('₹ — café 日本')).toBe(node('₹ — café 日本'));
  });

  it('hashes a config the way the build does', () => {
    expect(configHash(example)).toBe(node(JSON.stringify(example)).slice(0, 8));
    expect(configHash(example)).toHaveLength(8);
  });
});
