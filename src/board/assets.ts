// Kit models, terrain/water/cloud textures and the shared recoloured material caches
// (tint per player colour). Everything created here is shared across boards and
// flagged `userData.shared`, so disposeTree never frees it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { wrap } from 'comlink';
import type { DecodedImage, TextureWorkerApi } from '../workers/texture.worker';
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
  /** the 8 terrain normal layers, or a 1 px stand-in until `ensureTerrainNormals` has run (high / ultra only) */
  nrm: THREE.DataArrayTexture;
  nrmLoaded: boolean;
  water: THREE.Texture;
  clouds: THREE.Texture;
}

// ---------- assets ----------
let kitPromise: Promise<Kit> | null = null;
// recoloured copies of kit props (`name#variant`), made once and shared by every board
export const VARIANT_TINT: Record<string, THREE.Color> = { clay: new THREE.Color('#c86a4c') };
export const PROP_VARIANTS: Record<string, Map<THREE.Material, THREE.Material>> = {};
const KIT_TINT: Record<string, string> = { Leaf2: '#d4e8b0', LeafDark: '#a4c094', Pine2: '#c6dac8', StoneDark: '#b3aa9c', RockDark: '#a39d93' };
const WIND: Record<string, number> = { Leaf: 0.05, Leaf2: 0.05, LeafDark: 0.05, Pine: 0.035, Pine2: 0.035, Cloth: 0.08 };
export function loadKit(): Promise<Kit> {
  if (!kitPromise)
    kitPromise = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(ASSET('models/kit.glb')).then(g => {
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

// ---- terrain textures: decoded in a worker (fetch -> createImageBitmap -> OffscreenCanvas -> getImageData)
let texWorker: ReturnType<typeof wrap<TextureWorkerApi>> | null | undefined;
function worker() {
  if (texWorker !== undefined) return texWorker;
  texWorker = null;
  try {
    if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function')
      texWorker = wrap<TextureWorkerApi>(new Worker(new URL('../workers/texture.worker.ts', import.meta.url), { type: 'module' }));
  } catch {
    texWorker = null;
  }
  return texWorker;
}
const absolute = (url: string) => new URL(url, document.baseURI).href; // BASE_URL is './' in prod; the worker has no document base

// the old path (main thread): used when there is no OffscreenCanvas / Worker, or the worker failed
async function loadImagePixelsMain(url: string): Promise<DecodedImage> {
  const img = await new THREE.ImageLoader().loadAsync(url);
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  return { data: g.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height };
}
async function loadImagePixels(url: string): Promise<DecodedImage> {
  const w = worker();
  if (w) {
    try {
      return await w.decode(absolute(url));
    } catch (e) {
      if (/texture 404/.test(String((e as Error)?.message))) throw e; // missing file: the caller falls back
      console.warn('texture worker failed, decoding on the main thread', e);
    }
  }
  return loadImagePixelsMain(url);
}
// the 256 px set (`textures/low/`) when asked for and present, otherwise the full-size one
async function loadLayered(name: string, low: boolean): Promise<DecodedImage> {
  if (low) {
    try {
      return await loadImagePixels(ASSET(`textures/low/${name}`));
    } catch {}
  }
  return loadImagePixels(ASSET(`textures/${name}`));
}

// The terrain normal layers (~11 MB on the GPU, 8 extra reads per pixel) are only wanted by the tiers with
// `surfaceNormals` (high / ultra): the others keep a 1 px stand-in and never load the 8-layer file.
const DUMMY_NRM = (): DecodedImage => ({ data: new Uint8ClampedArray([128, 128, 255, 255]), w: 1, h: 1 });
function layeredArray(px: DecodedImage, srgb: boolean, low: boolean) {
  const layers = px.h / px.w;
  const t = new THREE.DataArrayTexture(new Uint8Array(px.data.buffer as ArrayBuffer), px.w, px.w, layers);
  t.format = THREE.RGBAFormat;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = px.w > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = px.w > 1;
  t.anisotropy = low ? 2 : 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return shared(t);
}

const nrmPromises = new Map<boolean, Promise<THREE.DataArrayTexture>>();
/** Loads the real terrain normal array (worker decode path as the albedo) into `tex` (once per size set). */
export async function ensureTerrainNormals(tex: Textures, low = false): Promise<void> {
  if (tex.nrmLoaded) return;
  let p = nrmPromises.get(low);
  if (!p) {
    p = loadLayered('terrain_normal.jpg', low).then(px => layeredArray(px, false, low));
    nrmPromises.set(low, p);
  }
  try {
    tex.nrm = await p;
    tex.nrmLoaded = true;
  } catch (e) {
    nrmPromises.delete(low);
    console.warn('terrain normals failed to load', e);
  }
}

const texPromises = new Map<boolean, Promise<Textures>>();
export function loadTextures(low = false): Promise<Textures> {
  let p = texPromises.get(low);
  if (!p) {
    p = Promise.all([loadLayered('terrain_albedo.jpg', low), Promise.resolve(DUMMY_NRM()),
      new THREE.TextureLoader().loadAsync(ASSET('textures/water_normal.jpg')), new THREE.TextureLoader().loadAsync(ASSET('textures/clouds.jpg'))]).then(([a, n, water, clouds]) => {
      water.wrapS = water.wrapT = THREE.RepeatWrapping;
      clouds.wrapS = clouds.wrapT = THREE.RepeatWrapping;
      U.uClouds.value = clouds;
      return { alb: layeredArray(a, true, low), nrm: layeredArray(n, false, low), nrmLoaded: false, water: shared(water), clouds: shared(clouds) };
    });
    texPromises.set(low, p);
  }
  return p;
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
