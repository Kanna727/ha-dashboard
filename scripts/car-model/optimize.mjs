// Shrinks a downloaded car glTF (e.g. from Sketchfab) into a .glb the kiosk can
// show: fewer triangles, 1024 px WebP textures, meshopt-compressed geometry.
// Node names and animations are kept, because the dashboard finds doors,
// wheels and lamps by name.
//
//   cd scripts/car-model && npm install
//   node optimize.mjs <in/scene.gltf> <out.glb> [--ratio 0.45] [--texture 1024]
//
// The model files are licensed for use, not redistribution: never commit them.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
// Keep this sharp on the same version as the one @gltf-transform/functions pulls
// in (via ndarray-pixels): two libvips copies in one process break encoding
// ("colourspace: parameter space not set").
import sharp from 'sharp';
import { statSync } from 'node:fs';

const [input, output, ...rest] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node optimize.mjs <in.gltf|glb> <out.glb> [--ratio 0.45] [--texture 1024]');
  process.exit(1);
}
const opt = (name, def) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? Number(rest[i + 1]) : def;
};
const ratio = opt('ratio', 0.45);
const texture = opt('texture', 1024);

const triangles = (doc) =>
  doc
    .getRoot()
    .listMeshes()
    .flatMap((m) => m.listPrimitives())
    .reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0) / 3, 0);

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const doc = await io.read(input);
const before = triangles(doc);

await doc.transform(
  dedup(),
  // keepLeaves: empty pivot nodes (door hinges, lamp groups) must survive.
  prune({ keepLeaves: true, keepAttributes: false }),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.0008 }),
  resample(), // drops the constant keyframes the export adds to every door part
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texture, texture] }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);

await io.write(output, doc);
const mb = (statSync(output).size / 1024 / 1024).toFixed(1);
console.log(`triangles ${Math.round(before).toLocaleString()} → ${Math.round(triangles(doc)).toLocaleString()}; ${output}: ${mb} MB`);
