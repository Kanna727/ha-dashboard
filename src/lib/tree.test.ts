import { describe, expect, it } from 'vitest';
import { growTree, rng, TREE_H, TREE_W, treeMasks } from './tree';

describe('grown tree', () => {
  const tree = growTree(7);

  it('is the same tree for the same seed', () => {
    expect(growTree(7)).toEqual(tree);
    expect(growTree(8)).not.toEqual(tree);
  });

  it('has a trunk from the ground and three limbs from its top', () => {
    expect(tree.trunk[0].y1).toBe(TREE_H);
    expect(tree.limbs).toHaveLength(3);
    const top = tree.trunk[tree.trunk.length - 1];
    for (const limb of tree.limbs) expect(limb.base).toEqual([top.x2, top.y2]);
  });

  it('tapers and carries plenty of leaves, all inside the box', () => {
    for (const limb of tree.limbs) {
      expect(limb.leaves.length).toBeGreaterThan(150);
      expect(Math.min(...limb.segments.map((s) => s.w))).toBeLessThan(limb.segments[0].w / 4);
      for (const l of limb.leaves) {
        expect(l.x).toBeGreaterThan(0);
        expect(l.x).toBeLessThan(TREE_W);
        expect(l.y).toBeGreaterThan(0);
      }
    }
  });

  it('builds one mask per limb, pivoting where it leaves the trunk', () => {
    const masks = treeMasks(tree);
    expect(masks.limbs).toHaveLength(3);
    expect(masks.trunk.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(masks.limbs[0].origin[1]).toBeGreaterThan(50);
    expect(masks.limbs[0].mask.length).toBeLessThan(150_000); // keep the inline SVGs small
  });
});

describe('rng', () => {
  it('gives a repeatable sequence in 0–1', () => {
    const a = rng(1);
    const b = rng(1);
    const xs = Array.from({ length: 50 }, () => a());
    expect(xs).toEqual(Array.from({ length: 50 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});
