// Post-process shaders (tilt-shift, piece outline, piece masks), the shared uniforms `U` and
// `patch()`, which injects fog-of-war / wind / cloud shadows / robber stain into any material.
import * as THREE from 'three';

// ---------- player pieces: sharp through the tilt-shift + a thin x-ray outline ----------
// Every frame two small masks are drawn: `vis` = the pieces you can actually see (depth-tested
// against the landscape) and `all` = every piece ignoring occlusion, both in the owner's colour.
// Layers: 0 landscape, 1 player pieces, 2 grass (left out of the depth pre-pass), 3 sprite labels.
export const LAYER_PIECES = 1, LAYER_GRASS = 2, LAYER_LABELS = 3; // 3: sprite labels (never in the mask / depth passes)
export const PASS_VS = 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
// tilt-shift that leaves the pieces crisp and never smears their colour onto the blurred land
export function tiltShader(dir: string) {
  return {
    uniforms: { tDiffuse: { value: null }, tMask: { value: null }, h: { value: 1 / 512 }, r: { value: 0.55 } },
    vertexShader: PASS_VS,
    fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D tMask; uniform float h; uniform float r; varying vec2 vUv;
      const float W[9] = float[9](0.051, 0.0918, 0.12245, 0.1531, 0.1633, 0.1531, 0.12245, 0.0918, 0.051);
      void main() {
        float m = texture2D(tMask, vUv).a;
        // a wide sharp band in the middle; only the far top/bottom edges get a soft blur
        float hh = h * max(abs(r - vUv.y) - 0.22, 0.0);
        if (m > 0.5 || hh <= 0.0) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
        vec4 sum = vec4(0.0); float ws = 0.0;
        for (int i = 0; i < 9; i++) {
          vec2 uv = vUv + vec2(${dir}) * float(i - 4) * hh;
          float w = W[i] * (1.0 - texture2D(tMask, uv).a);
          sum += texture2D(tDiffuse, uv) * w; ws += w;
        }
        gl_FragColor = sum / max(ws, 1e-4);
      }`,
  };
}
export const OutlineShader = {
  uniforms: { tDiffuse: { value: null }, tVis: { value: null }, tAll: { value: null }, uTexel: { value: new THREE.Vector2() } },
  vertexShader: PASS_VS,
  fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D tVis; uniform sampler2D tAll; uniform vec2 uTexel; varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec4 a = texture2D(tAll, vUv);
      vec3 col = base.rgb;
      if (a.a > 0.5) {
        // inside a piece that something hides: a faint glimpse of its colour
        if (texture2D(tVis, vUv).a < 0.5) col = mix(col, a.rgb, 0.22);
      } else {
        vec4 n = vec4(0.0); float nv = 0.0;
        for (int k = 0; k < 16; k++) {
          float ang = float(k) * 0.7853982;
          vec2 off = vec2(cos(ang), sin(ang)) * uTexel * (k < 8 ? 1.0 : 2.0);
          vec4 s = texture2D(tAll, vUv + off);
          if (s.a > 0.5) { n = s; nv = max(nv, texture2D(tVis, vUv + off).a); }
        }
        // visible edge: dark ink of the owner's colour; hidden edge: bright colour shining through
        if (n.a > 0.5) col = nv > 0.5 ? mix(col, n.rgb * 0.42, 0.85) : mix(col, n.rgb, 0.8);
      }
      gl_FragColor = vec4(col, base.a);
    }`,
};
// The same outline as a blended overlay drawn straight onto the canvas (no composer, no HDR target):
// every branch of OutlineShader is mix(col, X, k) = X blended with alpha k, so alpha-blending (X, k) over the
// already tone-mapped frame gives the identical pixel. Used by the tiers without an EffectComposer.
export const OutlineOverlayShader = {
  uniforms: { tVis: { value: null }, tAll: { value: null }, uTexel: { value: new THREE.Vector2() } },
  vertexShader: PASS_VS,
  fragmentShader: `uniform sampler2D tVis; uniform sampler2D tAll; uniform vec2 uTexel; varying vec2 vUv;
    void main() {
      vec4 a = texture2D(tAll, vUv);
      if (a.a > 0.5) {
        if (texture2D(tVis, vUv).a < 0.5) { gl_FragColor = vec4(a.rgb, 0.22); return; }
        discard;
      }
      vec4 n = vec4(0.0); float nv = 0.0;
      for (int k = 0; k < 16; k++) {
        float ang = float(k) * 0.7853982;
        vec2 off = vec2(cos(ang), sin(ang)) * uTexel * (k < 8 ? 1.0 : 2.0);
        vec4 s = texture2D(tAll, vUv + off);
        if (s.a > 0.5) { n = s; nv = max(nv, texture2D(tVis, vUv + off).a); }
      }
      if (n.a < 0.5) discard;
      gl_FragColor = nv > 0.5 ? vec4(n.rgb * 0.42, 0.85) : vec4(n.rgb, 0.8);
    }`,
};
// the visible mask pulls pieces a little towards the camera, so a base sunk a few mm into the
// terrain still counts as visible (only real occluders like hills and trees hide a piece)
const MASK_VS = `uniform float uPull;
void main() {
  vec4 p = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
  #endif
  vec4 mv = modelViewMatrix * p;
  mv.xyz -= normalize(mv.xyz) * uPull;
  gl_Position = projectionMatrix * mv;
}`;
export const pieceColorMat = (xray: boolean) => {
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uPull: { value: xray ? 0 : 0.14 } },
    vertexShader: MASK_VS,
    fragmentShader: 'uniform vec3 uColor;\nvoid main() { gl_FragColor = vec4(uColor, 1.0); }',
    depthTest: !xray,
    depthWrite: !xray,
    side: THREE.DoubleSide,
  });
  m.userData.pieceMask = true;
  return m;
};
// set per mesh while rendering the masks (the override material is shared)
export function pieceHook(this: THREE.Object3D, _r: unknown, _s: unknown, _c: unknown, _g: unknown, mat: THREE.Material) {
  if (!mat.userData.pieceMask) return;
  const sm = mat as THREE.ShaderMaterial;
  sm.uniforms.uColor!.value.copy(this.userData.pc);
  sm.uniformsNeedUpdate = true;
}

// ---------- shared shader uniforms ----------
export const U = {
  uTime: { value: 0 },
  uFogTex: { value: null as THREE.Texture | null },
  uFogRect: { value: new THREE.Vector4(-10, -10, 20, 20) },
  uFogOn: { value: 0 },
  uFogColor: { value: new THREE.Color('#0a0e1a') },
  uClouds: { value: null as THREE.Texture | null },
  uRobber: { value: new THREE.Vector3(0, 0, 0) }, // x, z of the robber's tile + tint strength
  uFx: { value: new THREE.Vector3(1, 1, 1) }, // wind / cloud shadows / sea foam on-off (set by the quality tier)
};

// Inject fog-of-war (+ optional wind / cloud shadows) into any built-in material.
export interface PatchOpts {
  wind?: number;
  clouds?: boolean;
  key?: string;
}
export function patch<T extends THREE.Material>(mat: T, opts: PatchOpts = {}): T {
  if (mat.userData.patched) return mat;
  mat.userData.patched = true;
  const wind = opts.wind || 0, clouds = !!opts.clouds;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'varying vec3 vFogW;\nuniform float uTime;\nuniform vec3 uFx;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  ${wind ? `{
    #ifdef USE_INSTANCING
      vec3 wp0 = (instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
    #else
      vec3 wp0 = (modelMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
    #endif
    float sway = sin(uTime * 1.6 + wp0.x * 1.7 + wp0.z * 1.1) + 0.4 * sin(uTime * 3.1 + wp0.z * 3.0);
    transformed.xz += vec2(0.8, 0.5) * sway * ${wind.toFixed(4)} * uFx.x * max(position.y, 0.0);
  }` : ''}`).replace('#include <project_vertex>', `#include <project_vertex>
  #ifdef USE_INSTANCING
    vFogW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  #else
    vFogW = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #endif`);
    sh.fragmentShader = 'varying vec3 vFogW;\nuniform sampler2D uFogTex;\nuniform vec4 uFogRect;\nuniform float uFogOn;\nuniform vec3 uFogColor;\nuniform sampler2D uClouds;\nuniform float uTime;\nuniform vec3 uRobber;\nuniform vec3 uFx;\n' +
      sh.fragmentShader.replace('#include <dithering_fragment>', `
  ${clouds ? `if (uFx.y > 0.5) {
    float cl = texture2D(uClouds, vFogW.xz * 0.045 + uTime * vec2(0.0045, 0.003)).r;
    gl_FragColor.rgb *= mix(1.0, 0.7, smoothstep(0.52, 0.72, cl));
  }` : ''}
  if (uRobber.z > 0.001) {
    // the robber's tile is stained red (pointy-top hex, inradius 0.866)
    vec2 rd = vFogW.xz - uRobber.xy;
    float hd = max(abs(rd.x), max(abs(dot(rd, vec2(0.5, 0.8660254))), abs(dot(rd, vec2(-0.5, 0.8660254)))));
    float inside = 1.0 - smoothstep(0.8, 0.86, hd);
    float rim = smoothstep(0.66, 0.8, hd) * inside;
    float pulse = 0.82 + 0.18 * sin(uTime * 3.2);
    vec3 stained = gl_FragColor.rgb * vec3(1.1, 0.36, 0.32) + vec3(0.2, 0.015, 0.0);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, stained, inside * uRobber.z * (0.55 + 0.45 * rim) * pulse);
  }
  if (uFogOn > 0.5) {
    vec2 fuv = (vFogW.xz - uFogRect.xy) / uFogRect.zw;
    float vis = texture2D(uFogTex, vec2(fuv.x, 1.0 - fuv.y)).r;
    gl_FragColor.rgb = mix(uFogColor, gl_FragColor.rgb, 0.05 + 0.95 * vis);
  }
  #include <dithering_fragment>`);
  };
  mat.customProgramCacheKey = () => `k${wind}${clouds}` + (opts.key || '');
  return mat;
}
