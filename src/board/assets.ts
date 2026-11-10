// Kit models, terrain/water/cloud textures and the shared recoloured material caches
// (tint per player colour, gold trims). Everything created here is shared across boards and
// flagged `userData.shared`, so disposeTree never frees it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { markShared, shared } from './dispose';
import { patch, U } from './shaders';

const ASSET = (p: string) => import.meta.env.BASE_URL + 'assets/' + p;

export interface Kit {
  [name: string]: THREE.Object3D;
  boat: THREE.Object3D;
  road: THREE.Object3D;
  house: THREE.Object3D;
  city: THREE.Object3D;
  robber: THREE.Object3D;
}
export interface Textures {
  alb: THREE.DataArrayTexture;
  nrm: THREE.DataArrayTexture;
  water: THREE.Texture;
  clouds: THREE.Texture;
}

// ---------- assets ----------
let kitPromise: Promise<Kit> | null = null, texPromise: Promise<Textures> | null = null;
// recoloured copies of kit props (`name#variant`), made once and shared by every board
export const VARIANT_TINT: Record<string, THREE.Color> = { clay: new THREE.Color('#c86a4c') };
export const PROP_VARIANTS: Record<string, Map<THREE.Material, THREE.Material>> = {};
const KIT_TINT: Record<string, string> = { Leaf2: '#d4e8b0', LeafDark: '#a4c094', Pine2: '#c6dac8', StoneDark: '#b3aa9c', RockDark: '#a39d93' };
const WIND: Record<string, number> = { Leaf: 0.05, Leaf2: 0.05, LeafDark: 0.05, Pine: 0.035, Pine2: 0.035, Cloth: 0.08 };
export function loadKit(): Promise<Kit> {
  if (!kitPromise)
    kitPromise = new GLTFLoader().loadAsync(ASSET('models/kit.glb')).then(g => {
      const kit: Record<string, THREE.Object3D> = {};
      for (const o of [...g.scene.children]) {
        o.position.set(0, 0, 0);
        o.updateMatrixWorld(true);
        o.traverse(obj => {
          const m = obj as THREE.Mesh;
          if (!m.isMesh) return;
          m.castShadow = m.receiveShadow = true;
          ([] as THREE.Material[]).concat(m.material).forEach(mt0 => {
            const mt = mt0 as THREE.MeshStandardMaterial;
            const tint = KIT_TINT[mt.name];
            if (tint) mt.color = new THREE.Color(tint);
            if (mt.map) {
              mt.map.anisotropy = 8;
              mt.map.wrapS = mt.map.wrapT = THREE.RepeatWrapping;
            }
            patch(mt, { wind: WIND[mt.name] || 0, key: mt.name });
          });
        });
        markShared(o); // the kit lives as long as the page: no board may dispose it
        kit[o.name] = o;
      }
      return kit as Kit;
    });
  return kitPromise;
}

async function loadImagePixels(url: string) {
  const img = await new THREE.ImageLoader().loadAsync(url);
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  return { data: g.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height, img };
}

export function loadTextures(): Promise<Textures> {
  if (!texPromise)
    texPromise = Promise.all([loadImagePixels(ASSET('textures/terrain_albedo.jpg')), loadImagePixels(ASSET('textures/terrain_normal.jpg')),
      new THREE.TextureLoader().loadAsync(ASSET('textures/water_normal.jpg')), new THREE.TextureLoader().loadAsync(ASSET('textures/clouds.jpg'))]).then(([a, n, water, clouds]) => {
      const arr = (p: { data: Uint8ClampedArray; w: number; h: number }, srgb: boolean) => {
        const layers = p.h / p.w;
        const t = new THREE.DataArrayTexture(new Uint8Array(p.data.buffer as ArrayBuffer), p.w, p.w, layers);
        t.format = THREE.RGBAFormat;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.generateMipmaps = true;
        t.anisotropy = 8;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.needsUpdate = true;
        return shared(t);
      };
      water.wrapS = water.wrapT = THREE.RepeatWrapping;
      clouds.wrapS = clouds.wrapT = THREE.RepeatWrapping;
      U.uClouds.value = clouds;
      return { alb: arr(a, true), nrm: arr(n, false), water: shared(water), clouds: shared(clouds) };
    });
  return texPromise;
}

const tintCache = new Map<string, THREE.Material>();
type Colors = Record<string, string>;
export function tinted(src: THREE.Object3D, colors: Colors): THREE.Object3D {
  const o = src.clone(true);
  o.traverse(obj => {
    const m = obj as THREE.Mesh;
    if (!m.isMesh) return;
    const swap = (mt: THREE.Material): THREE.Material => {
      const c = colors[mt.name];
      if (!c) return mt;
      const key = mt.uuid + c;
      if (!tintCache.has(key)) {
        const n = mt.clone() as THREE.MeshStandardMaterial;
        n.color = new THREE.Color(c);
        n.userData.patched = false;
        patch(n, { key: 'tint' });
        tintCache.set(key, shared(n));
      }
      return tintCache.get(key)!;
    };
    m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
  });
  return o;
}

// ---------- gold trims: every ADHD win of the match gilds a bit more of that player's pieces ----------
// 1 beams · 2 road edges and studs · 3 windows, chimney and plinth · 4 a gold knob on the roof · 5 the gold shines
const GOLD = new THREE.Color('#ffc94a');
const goldCache = new Map<string, THREE.MeshStandardMaterial>();
export const goldGlow = new Set<THREE.MeshStandardMaterial>(); // level-5 gold: its shine pulses (see tick)
export function goldOf(mt: THREE.Material, glow: boolean): THREE.MeshStandardMaterial {
  const key = mt.uuid + (glow ? 'G' : 'g');
  if (!goldCache.has(key)) {
    const n = mt.clone() as THREE.MeshStandardMaterial;
    n.color = GOLD.clone();
    n.map = null;
    n.metalness = 0.75;
    n.roughness = 0.28;
    n.transparent = false;
    n.opacity = 1;
    // a little light of its own, so the gold still reads as gold in the shade
    n.emissive = new THREE.Color('#ffb84a');
    n.emissiveIntensity = mt.name === 'Glass' ? 0.6 : 0.22;
    n.userData.patched = false;
    patch(n, { key: 'gold' });
    if (glow) goldGlow.add(n);
    goldCache.set(key, shared(n));
  }
  return goldCache.get(key)!;
}
export function gild(o: THREE.Object3D, names: string[], glow: boolean): THREE.Object3D {
  if (!names.length) return o;
  o.traverse(obj => {
    const m = obj as THREE.Mesh;
    if (!m.isMesh) return;
    const swap = (mt: THREE.Material): THREE.Material => (names.includes(mt.name) ? goldOf(mt, glow) : mt);
    m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
  });
  return o;
}
