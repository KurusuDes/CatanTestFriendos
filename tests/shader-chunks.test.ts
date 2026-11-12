// onBeforeCompile patches use string.replace on the RAW shader source (three resolves `#include`
// after onBeforeCompile runs). When a three.js upgrade renames a chunk the replace silently does
// nothing: this test checks every target still exists in the source we patch. Usage: pnpm test
import { test, expect } from 'vitest';
import * as THREE from 'three';

type Lib = { vertexShader: string; fragmentShader: string };
const lib = THREE.ShaderLib as unknown as Record<string, Lib>;
const chunk = THREE.ShaderChunk as unknown as Record<string, string>;

// [ShaderLib entry, stage, search string, where it is used]
const TARGETS: [string, 'vertexShader' | 'fragmentShader', string, string][] = [
  ['standard', 'vertexShader', '#include <begin_vertex>', 'shaders.ts wind, terrain.ts, water.ts, pieces.ts flag'],
  ['standard', 'vertexShader', '#include <project_vertex>', 'shaders.ts fog world pos'],
  ['standard', 'fragmentShader', '#include <dithering_fragment>', 'shaders.ts clouds/robber/fog of war'],
  ['standard', 'fragmentShader', '#include <map_fragment>', 'terrain.ts, water.ts'],
  ['standard', 'fragmentShader', '#include <normal_fragment_maps>', 'terrain.ts, water.ts (normal map read)'],
];

test.each(TARGETS)('MeshStandardMaterial %s %s contains %s (%s)', (mat, stage, target) => {
  expect(lib[mat]![stage].includes(target)).toBe(true);
});

// Targets that live INSIDE a chunk (not in the raw fragment source): terrain.ts / water.ts first replace the
// `#include <chunk>` line with the chunk's own text (THREE.ShaderChunk) and then patch that text. [chunk, target, use]
// The original bug: the sampling line was searched in the raw shader, where it does not exist, so nothing happened.
const CHUNK_TARGETS: [string, string, string][] = [
  ['normal_fragment_maps', 'texture2D( normalMap, vNormalMapUv ).xyz', 'terrain.ts splat(uNrm, ...), water.ts two-scroll sample'],
  ['normal_fragment_begin', 'vNormalMapUv', 'terrain.ts tangent frame from the splat uv'],
];

test.each(CHUNK_TARGETS)('chunk %s contains %s (%s)', (name, target) => {
  expect(chunk[name]!.includes(target)).toBe(true);
});

// the include line that gets replaced by the chunk text must exist in the raw shader, and the normal map path
// must be the tangent-space one (the materials set `normalMap`, which defines USE_NORMALMAP_TANGENTSPACE)
test.each(['normal_fragment_maps', 'normal_fragment_begin'])('raw standard fragment shader includes <%s> (replaced by its chunk text)', name => {
  expect(lib.standard!.fragmentShader.includes(`#include <${name}>`)).toBe(true);
});

test('the patched chunk keeps the tangent-space code path and normalScale', () => {
  expect(chunk.normal_fragment_maps).toContain('USE_NORMALMAP_TANGENTSPACE');
  expect(chunk.normal_fragment_maps).toContain('mapN.xy *= normalScale');
  expect(chunk.normal_fragment_begin).toContain('getTangentFrame');
});

test('names used by the injected GLSL exist', () => {
  const v = lib.standard!.vertexShader.replace(/#include <(\w+)>/g, (_m, n: string) => chunk[n] ?? '');
  for (const s of ['instanceMatrix', 'modelMatrix', 'transformed']) expect(v, s).toContain(s);
});
