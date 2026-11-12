// Terrain material and the three.js objects of the static island. The terrain field and all the generation
// maths are pure and live in terrainGen.ts (they run in terrain.worker.ts); here only GPU objects are made.
import * as THREE from 'three';
import type { BBoard } from './types';
import { patch } from './shaders';
import type { Textures } from './assets';
import type { Board3D } from './Board3D';
import type { GenResult } from './terrainGen';

export { pixelToHex, INR, NORMALS, L, TINT, vnoise, fbm, smooth, prng, TILE_LOOKS, LOOK_OVERRIDE, tileLook, terrainOf } from './terrainGen';
export type { TerrainField } from './terrainGen';

// strength of the splatted terrain normals (the old, never-active value was 1.1)
const NORMAL_SCALE = 0.9;

// terrain material: splat 8 array-texture layers + normals + wheat furrows
// `normals` (tiers high / ultra): the normal map is read through the same splat as the albedo. Without it the
// material keeps a 1 px flat normal map and the splat-normal code is not compiled at all.
export function terrainMaterial(tex: Textures, normals: boolean) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
  m.normalMap = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  m.normalMap.needsUpdate = true;
  m.normalScale = new THREE.Vector2(NORMAL_SCALE, NORMAL_SCALE);
  const base = m;
  base.onBeforeCompile = sh => {
    sh.uniforms.uAlb = { value: tex.alb };
    sh.uniforms.uNrm = { value: tex.nrm };
    sh.vertexShader = 'attribute vec4 aW0;\nattribute vec4 aW1;\nattribute float aRow;\nvarying vec4 vW0;\nvarying vec4 vW1;\nvarying float vRow;\nvarying vec2 vSplatUv;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vW0 = aW0; vW1 = aW1; vRow = aRow;
  vSplatUv = (modelMatrix * vec4(position, 1.0)).xz * 1.35;`);
    if (normals) {
      // `#include`s are resolved after onBeforeCompile: patch the chunk text, not the raw source. The tangent frame
      // is built from the splat uv (world xz) instead of the geometry uv; the textures are not flipped (row 0 = top,
      // v grows downwards) so v is negated to keep the green channel pointing the way the normal maps expect
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('vNormalMapUv', 'vec2(vSplatUv.x, -vSplatUv.y)'))
        .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('texture2D( normalMap, vNormalMapUv ).xyz', 'splat(uNrm, vSplatUv).xyz'));
    }
    sh.fragmentShader = 'precision highp sampler2DArray;\nuniform sampler2DArray uAlb;\nuniform sampler2DArray uNrm;\nvarying vec4 vW0;\nvarying vec4 vW1;\nvarying float vRow;\nvarying vec2 vSplatUv;\n' +
      `vec3 splat(sampler2DArray s, vec2 uv) {
        vec3 c = vec3(0.0);
        if (vW0.x > 0.004) c += vW0.x * texture(s, vec3(uv, 0.0)).rgb;
        if (vW0.y > 0.004) c += vW0.y * texture(s, vec3(uv, 1.0)).rgb;
        if (vW0.z > 0.004) c += vW0.z * texture(s, vec3(uv, 2.0)).rgb;
        if (vW0.w > 0.004) c += vW0.w * texture(s, vec3(uv * 0.55, 3.0)).rgb;
        if (vW1.x > 0.004) c += vW1.x * texture(s, vec3(uv, 4.0)).rgb;
        if (vW1.y > 0.004) c += vW1.y * texture(s, vec3(uv * 0.7, 5.0)).rgb;
        if (vW1.z > 0.004) c += vW1.z * texture(s, vec3(uv, 6.0)).rgb;
        if (vW1.w > 0.004) c += vW1.w * texture(s, vec3(uv, 7.0)).rgb;
        return c / max(dot(vW0, vec4(1.0)) + dot(vW1, vec4(1.0)), 0.0001);
      }\n` +
      sh.fragmentShader
        .replace('#include <map_fragment>', `
  vec3 salb = splat(uAlb, vSplatUv);
  // ploughed furrows on wheat fields
  float fur = smoothstep(0.18, 0.5, abs(fract(vRow * 7.5) - 0.5));
  salb = mix(salb, salb * vec3(0.62, 0.55, 0.45), vW1.z * (1.0 - fur) * 0.85);
  diffuseColor.rgb *= salb;`)
  };
  return patch(base, { clouds: true, key: normals ? 'terrainN' : 'terrain' });
}

// ---- terrain mesh: one continuous heightfield (the caller adds it to the static group)
export function buildTerrainMesh(board: Board3D, res: GenResult): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(res.pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(res.normal, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(res.color, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(res.uv, 2));
  geo.setAttribute('aW0', new THREE.BufferAttribute(res.aW0, 4));
  geo.setAttribute('aW1', new THREE.BufferAttribute(res.aW1, 4));
  geo.setAttribute('aRow', new THREE.BufferAttribute(res.aRow, 1));
  geo.setIndex(new THREE.BufferAttribute(res.index, 1));
  const terrain = new THREE.Mesh(geo, terrainMaterial(board.tex, board.params.surfaceNormals && board.tex.nrmLoaded));
  terrain.receiveShadow = terrain.castShadow = true;
  terrain.userData.own = true;
  return terrain;
}

// ---- subtle hex grid hugging the terrain (Civ style)
export function buildHexGrid(res: GenResult): THREE.LineSegments {
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(res.grid, 3));
  const grid = new THREE.LineSegments(lg, patch(new THREE.LineBasicMaterial({ color: '#fff6dc', transparent: true, opacity: 0.16 }), { key: 'grid' }));
  grid.userData.own = true;
  return grid;
}

/** Everything the terrain, props, grass and ports depend on (not the numbers: see tokenKey). */
export function terrainKey(bd: BBoard, faceDown: boolean): string {
  return bd.tiles.map(t => `${t.id}:${t.q},${t.r}${t.res}${t.revealed ? 1 : 0}`).join('|') + (faceDown ? 'F' : '') + bd.ports.length;
}
