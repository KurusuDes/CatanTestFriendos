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

// the normal-map read lives inside a chunk (not in the raw fragment source), so the terrain/water
// patches must target `#include <normal_fragment_maps>` and rewrite the chunk text themselves
test('normal_fragment_maps still reads the normal map as the terrain/water patches expect', () => {
  expect(chunk.normal_fragment_maps!.includes('texture2D( normalMap, vNormalMapUv ).xyz')).toBe(true);
});

test('names used by the injected GLSL exist', () => {
  const v = lib.standard!.vertexShader.replace(/#include <(\w+)>/g, (_m, n: string) => chunk[n] ?? '');
  for (const s of ['instanceMatrix', 'modelMatrix', 'transformed']) expect(v, s).toContain(s);
});
