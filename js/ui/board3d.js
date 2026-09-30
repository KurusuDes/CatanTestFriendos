// 3D map renderer — "realistic tabletop miniature".
// One continuous heightfield island textured by splatting 8 PBR-ish layers (grass,
// forest floor, dirt, rock, sand, snow, wheat field, meadow) with normal maps, lit by a
// physical sky (IBL), with a depth-aware sea (foam at the shore, animated normals),
// instanced Blender props (assets/models/kit.glb), instanced grass/wheat swaying in the
// wind, drifting cloud shadows, GTAO and tilt-shift. Tokens, port signs and click
// targets are crisp pixel-art CSS2D labels (the UI style).
// Same interface as BoardView: render(state, view), setZoom(), resetView(), dispose().
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPixelatedPass } from 'three/addons/postprocessing/RenderPixelatedPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { pips } from '../engine/constants.js';
import { pixelToHex, hk } from '../engine/board.js';
import { pxIcon } from './pixel.js';
import { flagCanvas } from './flag.js';

export const SETTINGS = { pixel: 1, tiltShift: true, quality: 'high', ao: true };
// phones and small screens start on the light preset
if (typeof matchMedia === 'function' && (matchMedia('(pointer: coarse)').matches || innerWidth < 900)) Object.assign(SETTINGS, { quality: 'low', ao: false });
try {
  Object.assign(SETTINGS, JSON.parse(localStorage.getItem('kchudites.gfx') || '{}'));
} catch {}

const INR = Math.sqrt(3) / 2; // hex inradius
const NORMALS = [0, 1, 2].map(k => [Math.cos((k * Math.PI) / 3), Math.sin((k * Math.PI) / 3)]);
const L = { grass: 0, forest: 1, dirt: 2, rock: 3, sand: 4, snow: 5, field: 6, meadow: 7 };
const TINT = { desert: new THREE.Color('#e3d6c0'), back: new THREE.Color('#b99873'), unknown: new THREE.Color('#9aa39c'), gold: new THREE.Color('#f0d27a'), white: new THREE.Color('#ffffff') };
const ASSET = p => new URL('../../assets/' + p, import.meta.url).href;

// ---------- noise ----------
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.28 + vnoise(x * 4.3, y * 4.3) * 0.17;
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function prng(seed) {
  let s = (Math.abs(seed | 0) % 233280) + 1;
  return () => (s = (s * 9301 + 49297) % 233280) / 233280;
}

// ---------- shared shader uniforms ----------
const U = {
  uTime: { value: 0 },
  uFogTex: { value: null },
  uFogRect: { value: new THREE.Vector4(-10, -10, 20, 20) },
  uFogOn: { value: 0 },
  uFogColor: { value: new THREE.Color('#0a0e1a') },
  uClouds: { value: null },
};

// Inject fog-of-war (+ optional wind / cloud shadows) into any built-in material.
function patch(mat, opts = {}) {
  if (mat.userData.patched) return mat;
  mat.userData.patched = true;
  const wind = opts.wind || 0, clouds = !!opts.clouds;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'varying vec3 vFogW;\nuniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  ${wind ? `{
    #ifdef USE_INSTANCING
      vec3 wp0 = (instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
    #else
      vec3 wp0 = (modelMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
    #endif
    float sway = sin(uTime * 1.6 + wp0.x * 1.7 + wp0.z * 1.1) + 0.4 * sin(uTime * 3.1 + wp0.z * 3.0);
    transformed.xz += vec2(0.8, 0.5) * sway * ${wind.toFixed(4)} * max(position.y, 0.0);
  }` : ''}`).replace('#include <project_vertex>', `#include <project_vertex>
  #ifdef USE_INSTANCING
    vFogW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  #else
    vFogW = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #endif`);
    sh.fragmentShader = 'varying vec3 vFogW;\nuniform sampler2D uFogTex;\nuniform vec4 uFogRect;\nuniform float uFogOn;\nuniform vec3 uFogColor;\nuniform sampler2D uClouds;\nuniform float uTime;\n' +
      sh.fragmentShader.replace('#include <dithering_fragment>', `
  ${clouds ? `{
    float cl = texture2D(uClouds, vFogW.xz * 0.045 + uTime * vec2(0.0045, 0.003)).r;
    gl_FragColor.rgb *= mix(1.0, 0.7, smoothstep(0.52, 0.72, cl));
  }` : ''}
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

// ---------- assets ----------
let kitPromise = null, texPromise = null;
const KIT_TINT = { Leaf2: '#d4e8b0', LeafDark: '#a4c094', Pine2: '#c6dac8', StoneDark: '#b3aa9c', RockDark: '#a39d93' };
const WIND = { Leaf: 0.05, Leaf2: 0.05, LeafDark: 0.05, Pine: 0.035, Pine2: 0.035, Cloth: 0.08 };
export function loadKit() {
  if (!kitPromise)
    kitPromise = new GLTFLoader().loadAsync(ASSET('models/kit.glb')).then(g => {
      const kit = {};
      for (const o of [...g.scene.children]) {
        o.position.set(0, 0, 0);
        o.updateMatrixWorld(true);
        o.traverse(m => {
          if (!m.isMesh) return;
          m.castShadow = m.receiveShadow = true;
          (Array.isArray(m.material) ? m.material : [m.material]).forEach(mt => {
            if (KIT_TINT[mt.name]) mt.color = new THREE.Color(KIT_TINT[mt.name]);
            if (mt.map) {
              mt.map.anisotropy = 8;
              mt.map.wrapS = mt.map.wrapT = THREE.RepeatWrapping;
            }
            patch(mt, { wind: WIND[mt.name] || 0, key: mt.name });
          });
        });
        kit[o.name] = o;
      }
      return kit;
    });
  return kitPromise;
}

async function loadImagePixels(url) {
  const img = await new THREE.ImageLoader().loadAsync(url);
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  return { data: g.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height, img };
}

function loadTextures() {
  if (!texPromise)
    texPromise = Promise.all([loadImagePixels(ASSET('textures/terrain_albedo.jpg')), loadImagePixels(ASSET('textures/terrain_normal.jpg')),
      new THREE.TextureLoader().loadAsync(ASSET('textures/water_normal.jpg')), new THREE.TextureLoader().loadAsync(ASSET('textures/clouds.jpg'))]).then(([a, n, water, clouds]) => {
      const arr = (p, srgb) => {
        const layers = p.h / p.w;
        const t = new THREE.DataArrayTexture(new Uint8Array(p.data.buffer), p.w, p.w, layers);
        t.format = THREE.RGBAFormat;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.generateMipmaps = true;
        t.anisotropy = 8;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.needsUpdate = true;
        return t;
      };
      water.wrapS = water.wrapT = THREE.RepeatWrapping;
      clouds.wrapS = clouds.wrapT = THREE.RepeatWrapping;
      U.uClouds.value = clouds;
      return { alb: arr(a, true), nrm: arr(n, false), water, clouds };
    });
  return texPromise;
}

const tintCache = new Map();
function tinted(src, colors) {
  const o = src.clone(true);
  o.traverse(m => {
    if (!m.isMesh) return;
    const swap = mt => {
      const c = colors[mt.name];
      if (!c) return mt;
      const key = mt.uuid + c;
      if (!tintCache.has(key)) {
        const n = mt.clone();
        n.color = new THREE.Color(c);
        n.userData.patched = false;
        patch(n, { key: 'tint' });
        tintCache.set(key, n);
      }
      return tintCache.get(key);
    };
    m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
  });
  return o;
}

// ---------- kingdom banners waving on every building ----------
const FLAG_GEO = new THREE.PlaneGeometry(0.17, 0.12, 10, 1).translate(0.085, 0, 0);
const POLE_MAT = new THREE.MeshStandardMaterial({ color: '#5b3e2b', roughness: 0.8 });
const flagMats = new Map();
function flagMaterial(flag) {
  const key = flag || '-';
  if (flagMats.has(key)) return flagMats.get(key);
  const tex = new THREE.CanvasTexture(flagCanvas(flag, 1));
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9 });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  transformed.z += sin(uTime * 6.0 + position.x * 42.0) * 0.02 * (position.x / 0.17);`);
  };
  patch(m, { key: 'flag' });
  flagMats.set(key, m);
  return m;
}
function banner(flag, x, z, height) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.006, height, 6).translate(0, height / 2, 0), patch(POLE_MAT, { key: 'pole' }));
  const cloth = new THREE.Mesh(FLAG_GEO, flagMaterial(flag));
  cloth.position.set(0.004, height - 0.065, 0);
  pole.castShadow = cloth.castShadow = true;
  g.add(pole, cloth);
  g.position.set(x, 0, z);
  return g;
}

function css2d(cls, html, tag = 'div') {
  const el = document.createElement(tag);
  el.className = cls;
  if (html) el.innerHTML = html;
  return new CSS2DObject(el);
}

// ---------- terrain field: height + splat weights + tint at any world point ----------
function terrainOf(st, faceDown) {
  const tiles = st.board.tiles;
  const land = new Map(tiles.map(t => [hk(t.q, t.r), t]));
  const kindOf = t => (!t.revealed ? (faceDown ? 'back' : 'unknown') : t.res);
  const seedOf = t => t.id * 7 + (t.q * 131 + t.r * 71);

  function featureH(kind, dx, dz, e, seed) {
    const fade = smooth(0.04, 0.32, e);
    const n = fbm(dx * 3 + seed, dz * 3 - seed);
    const bump = (cx, cz, r, h) => h * Math.exp(-((dx - cx) ** 2 + (dz - cz) ** 2) / (r * r));
    const rs = prng(seed);
    switch (kind) {
      case 'ore': {
        const a = rs() * 6.28;
        const peaks = bump(Math.cos(a) * 0.42, Math.sin(a) * 0.42, 0.3, 1.05) + bump(Math.cos(a + 2.3) * 0.45, Math.sin(a + 2.3) * 0.45, 0.24, 0.7) + bump(Math.cos(a - 2.1) * 0.4, Math.sin(a - 2.1) * 0.4, 0.2, 0.5);
        const ridge = 1 - Math.abs(vnoise(dx * 6 + seed, dz * 6) * 2 - 1);
        return 0.32 + fade * (peaks * (0.8 + 0.35 * ridge) + n * 0.05);
      }
      case 'brick': {
        const a = rs() * 6.28;
        return 0.3 + fade * (bump(Math.cos(a) * 0.4, Math.sin(a) * 0.4, 0.3, 0.2) + bump(Math.cos(a + 2.5) * 0.45, Math.sin(a + 2.5) * 0.45, 0.25, 0.16) + n * 0.06);
      }
      case 'gold':
        return 0.3 + fade * (n * 0.12 + bump(0.3, -0.3, 0.25, 0.15));
      case 'wood':
        return 0.3 + fade * n * 0.07;
      case 'sheep':
        return 0.28 + fade * n * 0.09;
      case 'wheat':
        return 0.26 + fade * n * 0.02;
      case 'desert':
        return 0.27 + fade * (Math.sin(dx * 8 + dz * 3.5 + seed) * 0.035 + n * 0.05);
      default:
        return 0.3;
    }
  }

  // splat weights (8 layers) of a terrain kind; w must be zeroed by the caller
  function featureW(kind, dx, dz, e, h, seed, w, k) {
    const n = fbm(dx * 4 + seed * 0.3, dz * 4 - seed * 0.2);
    switch (kind) {
      case 'wood':
        w[L.forest] += k * (0.75 + 0.25 * smooth(0.05, 0.25, e));
        w[L.grass] += k * 0.25 * (1 - smooth(0.05, 0.25, e));
        break;
      case 'sheep':
        w[L.meadow] += k;
        break;
      case 'wheat': {
        const f = smooth(0.05, 0.14, e);
        w[L.field] += k * f;
        w[L.grass] += k * (1 - f);
        break;
      }
      case 'brick': {
        const d = smooth(0.35, 0.65, n);
        w[L.dirt] += k * (0.45 + 0.55 * d);
        w[L.grass] += k * 0.55 * (1 - d);
        break;
      }
      case 'ore': {
        const r = smooth(0.42, 0.7, h), s = smooth(0.95, 1.12, h);
        w[L.snow] += k * s;
        w[L.rock] += k * r * (1 - s);
        w[L.grass] += k * (1 - r) * 0.7;
        w[L.dirt] += k * (1 - r) * 0.3;
        break;
      }
      case 'desert':
        w[L.sand] += k;
        break;
      case 'gold':
        w[L.rock] += k * 0.55;
        w[L.sand] += k * 0.45;
        break;
      case 'back':
        w[L.dirt] += k;
        break;
      default:
        w[L.grass] += k;
    }
  }

  // out: {w: Float32Array(8), tint: Color, row: number}
  function sample(x, z, out) {
    const [q, r] = pixelToHex(x, z);
    const t = land.get(hk(q, r));
    const cx = Math.sqrt(3) * (q + r / 2), cz = 1.5 * r;
    const dx = x - cx, dz = z - cz;
    let best = 0, bk = 0, bs = 1;
    for (let k = 0; k < 3; k++) {
      const p = dx * NORMALS[k][0] + dz * NORMALS[k][1];
      if (Math.abs(p) > best) {
        best = Math.abs(p);
        bk = k;
        bs = Math.sign(p) || 1;
      }
    }
    const e = INR - best;
    const nx = cx + NORMALS[bk][0] * bs * 2 * INR, nz = cz + NORMALS[bk][1] * bs * 2 * INR;
    const [nq, nr] = pixelToHex(nx, nz);
    const nt = land.get(hk(nq, nr));
    if (out) {
      out.w.fill(0);
      out.tint.copy(TINT.white);
      out.row = 0;
    }
    if (!t) {
      let dLand = 3;
      for (const [dq, dr] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) {
        const lt = land.get(hk(q + dq, r + dr));
        if (!lt) continue;
        const ldx = x - lt.x, ldz = z - lt.y;
        dLand = Math.min(dLand, Math.max(...NORMALS.map(n => Math.abs(ldx * n[0] + ldz * n[1]))) - INR);
      }
      const depth = smooth(0, 1.1, dLand);
      if (out) {
        out.w[L.sand] = 1 - depth * 0.6;
        out.w[L.rock] = depth * 0.6;
        out.tint.setRGB(1 - depth * 0.35, 1 - depth * 0.3, 1 - depth * 0.25);
      }
      return -0.34 - 0.65 * depth;
    }
    const kind = kindOf(t);
    const seed = seedOf(t);
    let h = featureH(kind, dx, dz, e, seed);
    const BL = 0.2;
    let wSelf = 1;
    if (e < BL && nt) {
      const wN = 0.5 * (1 - e / BL);
      wSelf = 1 - wN;
      const nk = kindOf(nt);
      const ndx = x - nx, ndz = z - nz;
      const ne = INR - Math.max(...NORMALS.map(n => Math.abs(ndx * n[0] + ndz * n[1])));
      const h2 = featureH(nk, ndx, ndz, ne, seedOf(nt));
      const hs = h;
      h = hs * wSelf + h2 * wN;
      if (out) {
        featureW(kind, dx, dz, e, hs, seed, out.w, wSelf);
        featureW(nk, ndx, ndz, ne, h2, seedOf(nt), out.w, wN);
        const ta = TINT[kind] || TINT.white, tb = TINT[nk] || TINT.white;
        out.tint.copy(ta).lerp(tb, wN);
      }
    } else if (e < BL && !nt) {
      // coast: cliff down to the sea, sandy foot
      const c = smooth(0.16, 0.0, e);
      const top = h;
      h = top * (1 - c) - 0.34 * c + (vnoise(x * 9, z * 9) - 0.5) * 0.06 * c;
      if (out) {
        featureW(kind, dx, dz, e, top, seed, out.w, 1 - c);
        out.w[L.rock] += c * (1 - smooth(0.75, 1, c));
        out.w[L.sand] += c * smooth(0.75, 1, c);
        out.tint.copy(TINT[kind] || TINT.white).lerp(TINT.white, c);
      }
    } else if (out) {
      featureW(kind, dx, dz, e, h, seed, out.w, 1);
      out.tint.copy(TINT[kind] || TINT.white);
    }
    if (out) {
      const a = (seed % 6) * 0.52;
      out.row = dx * Math.cos(a) + dz * Math.sin(a);
    }
    return h;
  }
  return { sample, land, kindOf, seedOf };
}

// terrain material: splat 8 array-texture layers + normals + wheat furrows
function terrainMaterial(tex) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
  m.normalMap = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  m.normalMap.needsUpdate = true;
  m.normalScale = new THREE.Vector2(1.1, 1.1);
  const base = m;
  base.onBeforeCompile = sh => {
    sh.uniforms.uAlb = { value: tex.alb };
    sh.uniforms.uNrm = { value: tex.nrm };
    sh.vertexShader = 'attribute vec4 aW0;\nattribute vec4 aW1;\nattribute float aRow;\nvarying vec4 vW0;\nvarying vec4 vW1;\nvarying float vRow;\nvarying vec2 vSplatUv;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vW0 = aW0; vW1 = aW1; vRow = aRow;
  vSplatUv = (modelMatrix * vec4(position, 1.0)).xz * 1.35;`);
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
        .replace('texture2D( normalMap, vNormalMapUv ).xyz', 'splat(uNrm, vSplatUv)');
  };
  base.customProgramCacheKey = () => 'terrainSplat';
  return patch(base, { clouds: true, key: 'terrain' });
}

function waterMaterial(tex, heightTex) {
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
  float foam = (1.0 - smoothstep(0.02, 0.2 + 0.08 * sin(uTime * 1.3 + vWxz.x * 3.0), depth)) * smoothstep(0.35, 0.7, n);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.96), foam);
  diffuseColor.a = mix(0.5, 0.93, smoothstep(0.0, 0.5, depth)) + foam * 0.4;`)
      .replace('texture2D( normalMap, vNormalMapUv ).xyz', `normalize(texture2D(normalMap, vWxz * 0.33 + uTime * vec2(0.012, 0.007)).xyz * 2.0 - 1.0 + texture2D(normalMap, vWxz * 0.57 - uTime * vec2(0.009, 0.013)).xyz * 2.0 - 1.0) * 0.5 + 0.5`);
  };
  m.customProgramCacheKey = () => 'water';
  return patch(m, { clouds: true, key: 'water' });
}

// a tuft of grass (or wheat): a few thin tapered blades with a vertical colour gradient
function tuftGeometry(blades, height, width, base, tip) {
  const pos = [], col = [];
  const cb = new THREE.Color(base), ct = new THREE.Color(tip);
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + i;
    const lean = 0.25 + (i % 3) * 0.12;
    const h = height * (0.7 + ((i * 37) % 10) / 30);
    const ox = Math.cos(a) * 0.012, oz = Math.sin(a) * 0.012;
    const px = Math.cos(a + 1.57) * width, pz = Math.sin(a + 1.57) * width;
    const tx = ox + Math.cos(a) * lean * h, tz = oz + Math.sin(a) * lean * h;
    pos.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, tx, h, tz);
    col.push(cb.r, cb.g, cb.b, cb.r, cb.g, cb.b, ct.r, ct.g, ct.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export class Board3D {
  static SETTINGS_TILT() { return SETTINGS.tiltShift; }
  static SETTINGS_PIXEL() { return SETTINGS.pixel; }
  static SETTINGS_Q() { return SETTINGS.quality; }
  static SETTINGS_AO() { return SETTINGS.ao; }

  static async create(container) {
    const [kit, tex] = await Promise.all([loadKit(), loadTextures()]);
    return new Board3D(container, kit, tex);
  }

  constructor(container, kit, tex) {
    this.container = container;
    this.kit = kit;
    this.tex = tex;
    this.zoom = 1;
    const hi = SETTINGS.quality === 'high';
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, hi ? 2 : 1));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.92;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = r.domElement;
    this.canvas.className = 'board-3d';
    container.append(this.canvas);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels-3d';
    container.append(this.labels.domElement);
    window.__board3d = this;

    const scene = (this.scene = new THREE.Scene());
    // physical sky + image based lighting from it
    const sky = new Sky();
    sky.scale.setScalar(450);
    const su = sky.material.uniforms;
    su.turbidity.value = 5.5;
    su.rayleigh.value = 1.3;
    su.mieCoefficient.value = 0.004;
    su.mieDirectionalG.value = 0.82;
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 34), THREE.MathUtils.degToRad(-125));
    su.sunPosition.value.copy(sunDir);
    this.sunDir = sunDir;
    scene.add(sky);
    const pm = new THREE.PMREMGenerator(r);
    const envScene = new THREE.Scene();
    envScene.add(sky.clone());
    this.envRT = pm.fromScene(envScene, 0.02);
    scene.environment = this.envRT.texture;
    scene.environmentIntensity = 0.55;
    pm.dispose();
    scene.fog = new THREE.Fog('#bfd3db', 34, 95);

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.3, 600);
    scene.add(new THREE.HemisphereLight('#e9f2ff', '#5b5243', 0.35));
    const sun = (this.sun = new THREE.DirectionalLight('#fff0d8', 3.4));
    sun.castShadow = true;
    const sm = hi ? 4096 : 2048;
    sun.shadow.mapSize.set(sm, sm);
    Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 90 });
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 2.5;
    scene.add(sun, sun.target);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), patch(new THREE.MeshStandardMaterial({ color: '#1d4f63', roughness: 1 }), { key: 'floor' }));
    floor.position.y = -1.25;
    scene.add(floor);

    this.staticGroup = new THREE.Group();
    this.dynGroup = new THREE.Group();
    scene.add(this.staticGroup, this.dynGroup);
    this.staticKey = '';
    this.spawns = [];
    this.plates = [];
    this.bobbers = [];
    this.prevPieces = new Set();

    this.controls = new OrbitControls(this.camera, this.canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, maxPolarAngle: 1.15, minPolarAngle: 0.3, minDistance: 3, maxDistance: 50, screenSpacePanning: false });

    this.composer = new EffectComposer(r);
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = this.fogCanvas.height = 512;
    this.fogTex = new THREE.CanvasTexture(this.fogCanvas);
    U.uFogTex.value = this.fogTex;
    this.setupPasses();

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.clock = new THREE.Clock();
    this.now = () => performance.now(); // overridable time source (frame-by-frame recording)
    this.alive = true;
    const loop = () => {
      if (!this.alive) return;
      this.raf = requestAnimationFrame(loop);
      this.tick();
    };
    loop();
  }

  setupPasses() {
    const c = this.composer;
    c.passes.slice().forEach(p => c.removePass(p));
    const px = SETTINGS.pixel | 0;
    const w = this.container.clientWidth || 800, h = this.container.clientHeight || 600;
    if (px > 1) c.addPass(new RenderPixelatedPass(px, this.scene, this.camera, { normalEdgeStrength: 0.25, depthEdgeStrength: 0.35 }));
    else {
      c.addPass(new RenderPass(this.scene, this.camera));
      if (SETTINGS.ao && SETTINGS.quality === 'high') {
        const ao = new GTAOPass(this.scene, this.camera, w, h);
        ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1.0, scale: 1.2, samples: 12 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
        ao.blendIntensity = 0.9;
        c.addPass(ao);
        this.aoPass = ao;
      }
    }
    this.hts = this.vts = null;
    if (SETTINGS.tiltShift) {
      this.hts = new ShaderPass(HorizontalTiltShiftShader);
      this.vts = new ShaderPass(VerticalTiltShiftShader);
      c.addPass(this.hts);
      c.addPass(this.vts);
    }
    c.addPass(new OutputPass());
    const vig = new ShaderPass(VignetteShader);
    vig.uniforms.offset.value = 0.95;
    vig.uniforms.darkness.value = 1.05;
    c.addPass(vig);
    this.resize();
  }

  setGraphics(opts) {
    Object.assign(SETTINGS, opts);
    try {
      localStorage.setItem('kchudites.gfx', JSON.stringify(SETTINGS));
    } catch {}
    this.setupPasses();
  }

  resize() {
    const w = this.container.clientWidth || 800, h = this.container.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.hts) {
      this.hts.uniforms.h.value = 3.0 / w;
      this.vts.uniforms.v.value = 3.0 / h;
      this.hts.uniforms.r.value = this.vts.uniforms.r.value = 0.55;
    }
  }

  dispose() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.controls.dispose();
    this.composer.dispose();
    this.envRT.dispose();
    this.renderer.dispose();
    this.canvas.remove();
    this.labels.domElement.remove();
  }

  setZoom(z) {
    const nz = Math.max(0.5, Math.min(4, z));
    const dir = this.camera.position.clone().sub(this.controls.target).multiplyScalar(this.zoom / nz);
    this.zoom = nz;
    this.camera.position.copy(this.controls.target).add(dir);
  }

  resetView() {
    this.zoom = 1;
    this.frame();
  }

  frame() {
    const b = this.bounds;
    if (!b) return;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minY + b.maxY) / 2;
    const size = Math.max(b.maxX - b.minX, (b.maxY - b.minY) * 1.2);
    const d = size * 0.86 + 1.4;
    this.controls.target.set(cx, 0.2, cz + 0.4);
    this.camera.position.set(cx, d * 0.8, cz + d * 0.62);
    this.controls.update();
  }

  placeSun(cx, cz) {
    const d = 28;
    this.sun.position.set(cx + this.sunDir.x * d, this.sunDir.y * d, cz + this.sunDir.z * d);
    this.sun.target.position.set(cx, 0, cz);
  }

  tick() {
    const t = this.clock.getElapsedTime();
    U.uTime.value = t;
    for (const b of this.bobbers) {
      b.obj.position.y = b.y + Math.sin(t * 1.4 + b.ph) * 0.025;
      b.obj.rotation.z = Math.sin(t * 1.1 + b.ph) * 0.05;
    }
    const now = this.now();
    this.spawns = this.spawns.filter(sp => {
      const k = Math.min(1, (now - sp.t0) / 450);
      const e = 1 - Math.pow(1 - k, 3);
      sp.obj.position.y = sp.y + (1 - e) * 1.2;
      sp.obj.scale.copy(sp.base).multiplyScalar(0.6 + e * 0.4);
      return k < 1;
    });
    this.plates = this.plates.filter(p => {
      const k = Math.max(0, Math.min(1, (now - p.t0) / 900));
      const e = k * k * (3 - 2 * k);
      p.obj.rotation.x = e * Math.PI;
      p.obj.position.y = p.y + Math.sin(e * Math.PI) * 1.2 + e * 0.5;
      p.obj.material.opacity = 1 - smooth(0.6, 1, k);
      if (k >= 1) {
        this.scene.remove(p.obj);
        return false;
      }
      return true;
    });
    this.controls.update();
    this.composer.render();
    this.labels.render(this.scene, this.camera);
  }

  // ---------- build ----------
  render(st, view = {}) {
    const bd = st.board;
    this.bounds = bd.bounds;
    const faceDown = !!view.faceDown;
    const key = bd.tiles.map(t => `${t.res}${t.num}${t.revealed ? 1 : 0}${t.numRevealed ? 1 : 0}`).join('|') + (faceDown ? 'F' : '') + bd.ports.length;
    if (key !== this.staticKey) {
      const first = !this.staticKey;
      this.staticKey = key;
      this.buildStatic(st, faceDown);
      if (first) this.frame();
    }
    if (view.flipAt && view.flipAt !== this.lastFlip) {
      this.lastFlip = view.flipAt;
      this.flipPlates(st);
    }
    this.markRolled(view.rolled);
    this.updateFog(st, view);
    this.buildDynamic(st, view);
  }

  heightAt(x, z) {
    return this.field ? this.field.sample(x, z) : 0.3;
  }

  buildStatic(st, faceDown) {
    const bd = st.board;
    for (const c of [...this.staticGroup.children]) {
      this.staticGroup.remove(c);
      c.traverse(o => {
        if (o.isCSS2DObject) o.element.remove();
        if (o.geometry && o.userData.own) o.geometry.dispose();
      });
    }
    this.bobbers = [];
    this.tokens = [];
    const field = (this.field = terrainOf(st, faceDown));
    const b = bd.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minY + b.maxY) / 2;
    this.placeSun(cx, cz);

    // ---- terrain mesh
    const STEP = SETTINGS.quality === 'high' ? 0.045 : 0.075;
    const x0 = b.minX - 0.8, z0 = b.minY - 0.8;
    const nx = Math.ceil((b.maxX - b.minX + 1.6) / STEP) + 1, nz = Math.ceil((b.maxY - b.minY + 1.6) / STEP) + 1;
    const N = nx * nz;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), uv = new Float32Array(N * 2);
    const w0 = new Float32Array(N * 4), w1 = new Float32Array(N * 4), row = new Float32Array(N);
    const out = { w: new Float32Array(8), tint: new THREE.Color(), row: 0 };
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * STEP, z = z0 + j * STEP;
        const h = field.sample(x, z, out);
        const k = j * nx + i;
        pos[k * 3] = x;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = z;
        col[k * 3] = out.tint.r;
        col[k * 3 + 1] = out.tint.g;
        col[k * 3 + 2] = out.tint.b;
        uv[k * 2] = x;
        uv[k * 2 + 1] = z;
        w0.set(out.w.subarray(0, 4), k * 4);
        w1.set(out.w.subarray(4, 8), k * 4);
        row[k] = out.row;
      }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let p = 0;
    for (let j = 0; j < nz - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, bq = a + 1, c = a + nx, d = c + 1;
        idx[p++] = a; idx[p++] = c; idx[p++] = bq; idx[p++] = bq; idx[p++] = c; idx[p++] = d;
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aW0', new THREE.BufferAttribute(w0, 4));
    geo.setAttribute('aW1', new THREE.BufferAttribute(w1, 4));
    geo.setAttribute('aRow', new THREE.BufferAttribute(row, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    // steep slopes become rock
    const nrm = geo.attributes.normal.array;
    for (let k = 0; k < N; k++) {
      const steep = smooth(0.84, 0.58, nrm[k * 3 + 1]);
      if (steep <= 0 || pos[k * 3 + 1] < -0.3) continue;
      for (let q = 0; q < 4; q++) {
        w0[k * 4 + q] *= 1 - steep;
        w1[k * 4 + q] *= 1 - steep;
      }
      w0[k * 4 + 3] += steep;
    }
    const terrain = new THREE.Mesh(geo, terrainMaterial(this.tex));
    terrain.receiveShadow = terrain.castShadow = true;
    terrain.userData.own = true;
    this.staticGroup.add(terrain);

    // ---- seabed heightmap for the water shader
    const HM = 256, pad = 3;
    const rect = new THREE.Vector4(b.minX - pad, b.minY - pad, b.maxX - b.minX + 2 * pad, b.maxY - b.minY + 2 * pad);
    const hdata = new Uint8Array(HM * HM * 4);
    for (let j = 0; j < HM; j++)
      for (let i = 0; i < HM; i++) {
        const hh = field.sample(rect.x + ((i + 0.5) / HM) * rect.z, rect.y + ((j + 0.5) / HM) * rect.w);
        const v = Math.max(0, Math.min(255, Math.round(((hh + 1.2) / 2.7) * 255)));
        const k = (j * HM + i) * 4;
        hdata[k] = hdata[k + 1] = hdata[k + 2] = v;
        hdata[k + 3] = 255;
      }
    const htex = new THREE.DataTexture(hdata, HM, HM);
    htex.magFilter = htex.minFilter = THREE.LinearFilter;
    htex.needsUpdate = true;
    htex.userData.rect = rect;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(600, 600, 1, 1).rotateX(-Math.PI / 2), waterMaterial(this.tex, htex));
    water.position.y = 0;
    water.receiveShadow = true;
    water.userData.own = true;
    this.water = water;
    this.staticGroup.add(water);

    // ---- subtle hex grid hugging the terrain (Civ style)
    const lines = [];
    for (const e of bd.edges) {
      const a = bd.vertices[e.a], c = bd.vertices[e.b];
      for (let s = 0; s < 6; s++) {
        const t0 = s / 6, t1 = (s + 1) / 6;
        const xa = a.x + (c.x - a.x) * t0, za = a.y + (c.y - a.y) * t0, xb = a.x + (c.x - a.x) * t1, zb = a.y + (c.y - a.y) * t1;
        lines.push(xa, field.sample(xa, za) + 0.014, za, xb, field.sample(xb, zb) + 0.014, zb);
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    const grid = new THREE.LineSegments(lg, patch(new THREE.LineBasicMaterial({ color: '#fff6dc', transparent: true, opacity: 0.16 }), { key: 'grid' }));
    grid.userData.own = true;
    this.staticGroup.add(grid);

    this.placeProps(st);
    this.placeGrass(st);

    // ---- tokens + face-down runes (pixel UI labels)
    for (const t of bd.tiles) {
      const h = field.sample(t.x, t.y);
      if (!t.revealed) {
        if (faceDown) {
          const rune = css2d('rune3d', '✦');
          rune.position.set(t.x, h + 0.05, t.y);
          this.staticGroup.add(rune);
        }
        continue;
      }
      if (t.res === 'desert') continue;
      const red = t.numRevealed && (t.num === 6 || t.num === 8);
      const tok = css2d('tok3d' + (red ? ' red' : ''), t.numRevealed ? `<span>${t.num}</span><i>${'•'.repeat(pips(t.num))}</i>` : '<span>?</span>');
      tok.position.set(t.x, Math.max(h, 0.3) + 0.12, t.y);
      tok.userData.num = t.numRevealed ? t.num : null;
      this.tokens.push(tok);
      this.staticGroup.add(tok);
    }

    // ---- ports: pier, boat and a pixel sign
    for (const port of bd.ports) {
      const E = bd.edges[port.edge];
      const a = bd.vertices[E.a], c = bd.vertices[E.b];
      const mx = (a.x + c.x) / 2, mz = (a.y + c.y) / 2;
      const dock = this.kit.dock.clone();
      dock.position.set(mx + port.nx * 0.25, 0.08, mz + port.ny * 0.25);
      dock.rotation.y = -Math.atan2(port.ny, port.nx);
      dock.scale.setScalar(1.2);
      const boat = this.kit.boat.clone();
      boat.position.set(port.x + port.ny * 0.3, 0.0, port.y - port.nx * 0.3);
      boat.rotation.y = -Math.atan2(port.ny, port.nx) + Math.PI / 2;
      boat.scale.setScalar(1.35);
      this.bobbers.push({ obj: boat, y: 0.0, ph: port.id * 1.7 });
      const sign = css2d('port3d', port.type === 'any' ? '<b>3:1</b>' : `${pxIcon(port.type, 16).outerHTML}<b>2:1</b>`);
      sign.position.set(port.x, 0.55, port.y);
      this.staticGroup.add(dock, boat, sign);
    }
  }

  // instanced Blender props (forests, sheep, improvements...) sitting on the terrain
  placeProps(st) {
    const kit = this.kit;
    const field = this.field;
    const bd = st.board;
    const inst = {};
    const put = (name, x, z, s = 1, ry = 0) => (inst[name] = inst[name] || []).push([x, field.sample(x, z) - 0.01, z, s, ry]);
    const cornerSafe = (x, z) => !bd.vertices.some(v => (v.x - x) ** 2 + (v.y - z) ** 2 < 0.05);
    for (const t of bd.tiles) {
      if (!t.revealed) continue;
      const rnd = prng(t.id * 977 + t.q * 31 + t.r * 17 + 5);
      const spots = (n, r0, r1, fn) => {
        let placed = 0;
        for (let tries = 0; placed < n && tries < n * 6; tries++) {
          const a = rnd() * Math.PI * 2, rr = r0 + rnd() * (r1 - r0);
          const x = t.x + Math.cos(a) * rr, z = t.y + Math.sin(a) * rr;
          if (!cornerSafe(x, z)) continue;
          fn(x, z, placed++);
        }
      };
      switch (t.res) {
        case 'wood':
          spots(30, 0.22, 0.8, (x, z, i) => put(i % 3 ? 'pine' : 'oak', x, z, 0.85 + rnd() * 0.55, rnd() * 6.3));
          spots(1, 0.5, 0.6, (x, z) => put('lumber', x, z, 1.1, rnd() * 6.3));
          break;
        case 'sheep':
          spots(5, 0.3, 0.72, (x, z) => put('sheep', x, z, 1.15, rnd() * 6.3));
          spots(3, 0.45, 0.8, (x, z) => put('bush', x, z, 1 + rnd() * 0.5, rnd() * 6.3));
          spots(2, 0.5, 0.7, (x, z) => put('oak', x, z, 0.9, rnd() * 6.3));
          spots(2, 0.55, 0.7, (x, z) => put('fence', x, z, 1.2, rnd() * 6.3));
          break;
        case 'wheat':
          spots(1, 0.45, 0.55, (x, z) => put('windmill', x, z, 1.35, rnd() * 6.3));
          spots(3, 0.35, 0.75, (x, z) => put(rnd() > 0.5 ? 'hay' : 'sheaf', x, z, 1, rnd() * 6.3));
          break;
        case 'brick':
          spots(1, 0.45, 0.6, (x, z) => put('kiln', x, z, 1.3, rnd() * 6.3));
          spots(2, 0.4, 0.8, (x, z) => put('rock', x, z, 0.6 + rnd() * 0.4, rnd() * 6.3));
          spots(4, 0.4, 0.8, (x, z) => put('bush', x, z, 0.9, rnd() * 6.3));
          break;
        case 'ore':
          spots(1, 0.35, 0.5, (x, z) => put('mine', x, z, 1.3, rnd() * 6.3));
          spots(4, 0.35, 0.8, (x, z) => put('rock', x, z, 0.7 + rnd() * 0.6, rnd() * 6.3));
          spots(5, 0.55, 0.8, (x, z) => put('pine', x, z, 0.7, rnd() * 6.3));
          break;
        case 'desert':
          spots(5, 0.3, 0.8, (x, z) => put('cactus', x, z, 1 + rnd() * 0.6, rnd() * 6.3));
          spots(3, 0.3, 0.8, (x, z) => put('rock', x, z, 0.55 + rnd() * 0.4, rnd() * 6.3));
          break;
        case 'gold':
          spots(6, 0.3, 0.75, (x, z) => put('crystal', x, z, 1.2 + rnd() * 0.8, rnd() * 6.3));
          break;
      }
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const [name, list] of Object.entries(inst)) {
      const proto = kit[name];
      if (!proto) continue;
      proto.updateMatrixWorld(true);
      proto.traverse(child => {
        if (!child.isMesh) return;
        const im = new THREE.InstancedMesh(child.geometry, child.material, list.length);
        im.castShadow = im.receiveShadow = true;
        list.forEach(([x, y, z, s, ry], i) => {
          m4.compose(pv.set(x, y, z), q.setFromAxisAngle(up, ry), sv.set(s, s, s)).multiply(child.matrixWorld);
          im.setMatrixAt(i, m4);
        });
        im.instanceMatrix.needsUpdate = true;
        this.staticGroup.add(im);
      });
    }
  }

  // thousands of wind-swept grass and wheat tufts
  placeGrass(st) {
    const bd = st.board;
    const field = this.field;
    const hi = SETTINGS.quality === 'high';
    const kinds = { sheep: ['grass', hi ? 320 : 120], wheat: ['wheat', hi ? 420 : 160], brick: ['grass', hi ? 90 : 30], wood: ['grass', hi ? 60 : 20], ore: ['grass', hi ? 50 : 15], gold: ['grass', 20] };
    const lists = { grass: [], wheat: [] };
    for (const t of bd.tiles) {
      const spec = t.revealed && kinds[t.res];
      if (!spec) continue;
      const rnd = prng(t.id * 1543 + 17);
      for (let i = 0; i < spec[1]; i++) {
        const x = t.x + (rnd() - 0.5) * 1.8, z = t.y + (rnd() - 0.5) * 1.8;
        const [q, r] = pixelToHex(x, z);
        if (q !== t.q || r !== t.r) continue;
        const dx = x - t.x, dz = z - t.y;
        const e = INR - Math.max(...NORMALS.map(n => Math.abs(dx * n[0] + dz * n[1])));
        if (e < 0.09) continue; // keep roads and corners clear
        if (t.res === 'ore' && field.sample(x, z) > 0.55) continue;
        lists[spec[0]].push([x, field.sample(x, z), z, 0.7 + rnd() * 0.7, rnd() * 6.3]);
      }
    }
    const defs = {
      grass: tuftGeometry(6, 0.075, 0.009, '#3f6a2a', '#a6c95e'),
      wheat: tuftGeometry(7, 0.13, 0.008, '#8a6a26', '#f0d27a'),
    };
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const [k, list] of Object.entries(lists)) {
      if (!list.length) continue;
      const mat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 }), { wind: k === 'wheat' ? 0.5 : 0.45, key: 'tuft' + k });
      const im = new THREE.InstancedMesh(defs[k], mat, list.length);
      im.receiveShadow = true;
      im.castShadow = k === 'wheat';
      list.forEach(([x, y, z, s, ry], i) => {
        m4.compose(pv.set(x, y - 0.005, z), q.setFromAxisAngle(up, ry), sv.set(s, s, s));
        im.setMatrixAt(i, m4);
      });
      im.userData.own = true;
      this.staticGroup.add(im);
    }
  }

  flipPlates(st) {
    const bd = st.board;
    const cx = (bd.bounds.minX + bd.bounds.maxX) / 2, cz = (bd.bounds.minY + bd.bounds.maxY) / 2;
    const geo = new THREE.CylinderGeometry(0.98, 0.98, 0.06, 6);
    const now = this.now();
    for (const t of bd.tiles) {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#8a6443', roughness: 0.8, transparent: true }));
      m.position.set(t.x, 1.6, t.y);
      m.castShadow = true;
      this.scene.add(m);
      this.plates.push({ obj: m, y: 1.6, t0: now + Math.hypot(t.x - cx, t.y - cz) * 130 });
    }
  }

  markRolled(num) {
    for (const tk of this.tokens || []) tk.element.classList.toggle('rolled', num != null && tk.userData.num === num);
  }

  updateFog(st, view) {
    const vis = view.vision;
    U.uFogOn.value = vis ? 1 : 0;
    if (!vis) return;
    const b = st.board.bounds;
    const pad = 8;
    const rect = { x: b.minX - pad, z: b.minY - pad, w: b.maxX - b.minX + pad * 2, h: b.maxY - b.minY + pad * 2 };
    U.uFogRect.value.set(rect.x, rect.z, rect.w, rect.h);
    const c = this.fogCanvas, g = c.getContext('2d', { willReadFrequently: true });
    const sx = c.width / rect.w, sz = c.height / rect.h;
    g.filter = 'none';
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, c.height);
    g.filter = `blur(${Math.max(2, Math.round(sx * 0.16))}px)`;
    g.fillStyle = g.strokeStyle = '#fff';
    g.lineCap = 'round';
    for (const [x, y, r] of vis.circles) {
      g.beginPath();
      g.arc((x - rect.x) * sx, (y - rect.z) * sz, r * sx, 0, Math.PI * 2);
      g.fill();
    }
    for (const [x1, y1, x2, y2, r] of vis.caps) {
      g.lineWidth = r * 2 * sx;
      g.beginPath();
      g.moveTo((x1 - rect.x) * sx, (y1 - rect.z) * sz);
      g.lineTo((x2 - rect.x) * sx, (y2 - rect.z) * sz);
      g.stroke();
    }
    g.filter = 'none';
    this.fogTex.needsUpdate = true;
    const lit = (x, z) => {
      const px = Math.floor((x - rect.x) * sx), pz = Math.floor((z - rect.z) * sz);
      return g.getImageData(Math.max(0, Math.min(511, px)), Math.max(0, Math.min(511, pz)), 1, 1).data[0] > 90;
    };
    this.staticGroup.traverse(o => {
      if (o.isCSS2DObject) o.visible = lit(o.position.x, o.position.z);
    });
  }

  buildDynamic(st, view) {
    const bd = st.board;
    const kit = this.kit;
    for (const c of [...this.dynGroup.children]) {
      this.dynGroup.remove(c);
      c.traverse(o => o.isCSS2DObject && o.element.remove());
    }
    const pieces = new Set();
    const vy = v => Math.max(this.heightAt(bd.vertices[v].x, bd.vertices[v].y), 0.05);
    const add = (obj, key) => {
      this.dynGroup.add(obj);
      pieces.add(key);
      if (this.prevPieces.size && !this.prevPieces.has(key)) this.spawns.push({ obj, y: obj.position.y, base: obj.scale.clone(), t0: this.now() });
    };
    const ghostify = o => o.traverse(m => {
      if (m.isMesh) {
        m.material = m.material.clone();
        m.material.transparent = true;
        m.material.opacity = 0.5;
      }
    });
    const colors = c => ({ Player: c, Banner: c, PlayerWood: c });
    const road = (eid, color, ghost) => {
      const E = bd.edges[eid], a = bd.vertices[E.a], b = bd.vertices[E.b];
      const o = tinted(kit.road, colors(color));
      const ya = vy(E.a), yb = vy(E.b);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      o.position.set((a.x + b.x) / 2, (ya + yb) / 2 + 0.01, (a.y + b.y) / 2);
      o.rotation.order = 'YZX';
      o.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
      o.rotation.z = Math.atan2(yb - ya, len);
      if (ghost) ghostify(o);
      o.scale.set(1.08, 2.2, 2.1);
      add(o, 'r' + eid + (ghost ? 'g' : ''));
    };
    for (const k in st.roads) road(+k, st.players[st.roads[k]].color);
    for (const b of view.blindOwn || []) if (b.eid != null) road(b.eid, st.players[b.pid].color, true);
    const building = (vid, owner, type, ghost) => {
      const V = bd.vertices[vid];
      const o = tinted(type === 'city' ? kit.city : kit.house, colors(st.players[owner].color));
      o.position.set(V.x, vy(vid) - 0.01, V.y);
      o.rotation.y = ((vid * 2.39996) % 6.28) * 0.4;
      const pl = st.players[owner];
      if (pl.flag) o.add(type === 'city' ? banner(pl.flag, 0.18, 0.13, 0.46) : banner(pl.flag, 0.1, 0.07, 0.36));
      if (ghost) ghostify(o);
      o.scale.setScalar(type === 'city' ? 1.25 : 1.45);
      add(o, 'b' + vid + type + (ghost ? 'g' : ''));
    };
    for (const k in st.buildings) building(+k, st.buildings[k].owner, st.buildings[k].type);
    for (const b of view.blindOwn || []) building(b.vid, b.pid, b.type, true);

    if (bd.robber >= 0 && !st.config.rules.noRobber && bd.tiles[bd.robber].revealed && !bd.robberHidden) {
      const t = bd.tiles[bd.robber];
      const o = kit.robber.clone();
      const x = t.x - 0.3, z = t.y + 0.22;
      o.position.set(x, Math.max(this.heightAt(x, z), 0.1), z);
      o.scale.setScalar(1.3);
      add(o, 'robber' + t.id);
    }

    const inter = view.interaction;
    if (inter) {
      const mk = (id, x, y, z, cls) => {
        const el = document.createElement('button');
        el.className = 'hot3d ' + cls;
        el.style.setProperty('--pc', inter.color || '#fff');
        el.addEventListener('pointerdown', e => e.stopPropagation());
        el.addEventListener('click', e => {
          e.stopPropagation();
          inter.onPick(id);
        });
        const o = new CSS2DObject(el);
        o.position.set(x, y, z);
        this.dynGroup.add(o);
      };
      if (inter.kind === 'settlement' || inter.kind === 'city')
        for (const v of inter.legal) {
          const V = bd.vertices[v];
          mk(v, V.x, vy(v) + (inter.kind === 'city' ? 0.45 : 0.08), V.y, 'v');
        }
      else if (inter.kind === 'road')
        for (const e of inter.legal) {
          const E = bd.edges[e], a = bd.vertices[E.a], b = bd.vertices[E.b];
          mk(e, (a.x + b.x) / 2, (vy(E.a) + vy(E.b)) / 2 + 0.06, (a.y + b.y) / 2, 'e');
        }
      else if (inter.kind === 'robber')
        for (const id of inter.legal) {
          const t = bd.tiles[id];
          mk(id, t.x + 0.3, Math.max(this.heightAt(t.x, t.y), 0.3) + 0.3, t.y - 0.25, 't');
        }
    }
    this.prevPieces = pieces;
  }
}
