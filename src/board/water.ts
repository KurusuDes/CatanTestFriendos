// The sea: depth-aware water shader over a seabed heightmap sampled from the terrain field.
import * as THREE from 'three';
import { patch, U } from './shaders';
import type { Textures } from './assets';
import type { BState } from './types';
import type { Board3D } from './Board3D';
import { SEABED_PAD, SEABED_RES, type GenResult } from './terrainGen';

function waterMaterial(tex: Textures, heightTex: THREE.DataTexture) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.05, metalness: 0.02, transparent: true, normalMap: tex.water, normalScale: new THREE.Vector2(0.35, 0.35) });
  m.onBeforeCompile = sh => {
    sh.uniforms.uHeight = { value: heightTex };
    sh.uniforms.uHRect = { value: heightTex.userData.rect };
    sh.uniforms.uTime = U.uTime;
    sh.vertexShader = 'varying vec2 vWxz;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vWxz = (modelMatrix * vec4(position, 1.0)).xz;`);
    sh.fragmentShader = 'varying vec2 vWxz;\nuniform sampler2D uHeight;\nuniform vec4 uHRect;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', `
  vec2 huv = (vWxz - uHRect.xy) / uHRect.zw;
  float seabed = texture2D(uHeight, huv).r * 2.7 - 1.2;
  float depth = clamp(-seabed, 0.0, 2.0);
  vec3 shallow = vec3(0.30, 0.72, 0.74), deep = vec3(0.03, 0.22, 0.33);
  diffuseColor.rgb = mix(shallow, deep, smoothstep(0.0, 0.85, depth));
  float n = texture2D(normalMap, vWxz * 0.9 + uTime * vec2(0.03, 0.02)).r;
  float foam = (1.0 - smoothstep(0.02, 0.2 + 0.08 * sin(uTime * 1.3 + vWxz.x * 3.0), depth)) * smoothstep(0.35, 0.7, n) * uFx.z;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.96), foam);
  diffuseColor.a = mix(0.5, 0.93, smoothstep(0.0, 0.5, depth)) + foam * 0.4;`)
      .replace('texture2D( normalMap, vNormalMapUv ).xyz', `normalize(texture2D(normalMap, vWxz * 0.33 + uTime * vec2(0.012, 0.007)).xyz * 2.0 - 1.0 + texture2D(normalMap, vWxz * 0.57 - uTime * vec2(0.009, 0.013)).xyz * 2.0 - 1.0) * 0.5 + 0.5`);
  };
  m.customProgramCacheKey = () => 'water';
  return patch(m, { clouds: true, key: 'water' });
}

// ---- seabed heightmap for the water shader + the water plane (the caller adds it to the static group)
export function buildWater(board: Board3D, st: BState, res: GenResult): THREE.Mesh {
  const b = st.board.bounds;
  const HM = SEABED_RES, pad = SEABED_PAD;
  const rect = new THREE.Vector4(b.minX - pad, b.minY - pad, b.maxX - b.minX + 2 * pad, b.maxY - b.minY + 2 * pad);
  // the worker made one byte per texel: expand to grey RGBA
  const hdata = new Uint8Array(HM * HM * 4);
  for (let k = 0; k < HM * HM; k++) {
    const v = res.seabed[k]!;
    hdata[k * 4] = hdata[k * 4 + 1] = hdata[k * 4 + 2] = v;
    hdata[k * 4 + 3] = 255;
  }
  const htex = new THREE.DataTexture(hdata, HM, HM);
  htex.magFilter = htex.minFilter = THREE.LinearFilter;
  htex.needsUpdate = true;
  htex.userData.rect = rect;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(600, 600, 1, 1).rotateX(-Math.PI / 2), waterMaterial(board.tex, htex));
  water.position.y = 0;
  water.receiveShadow = true;
  water.userData.own = true;
  // the heightmap is only referenced by the shader uniforms: dispose it with the water
  water.userData.extra = [htex];
  return water;
}
