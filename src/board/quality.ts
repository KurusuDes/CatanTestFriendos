// Quality tiers of the 3D board: one table of parameters per tier + automatic device detection.
// Pure (no three.js, no module state) so it can be unit-tested; settings.ts keeps the user's choice.
export type Tier = 'ultra' | 'high' | 'medium' | 'low';
export const TIERS: Tier[] = ['ultra', 'high', 'medium', 'low'];
export const TIER_LABEL: Record<Tier, string> = { ultra: 'Cực đẹp', high: 'Cao', medium: 'Vừa', low: 'Máy yếu' };

export interface TierParams {
  /** device pixel ratio is clamped to this */
  maxPR: number;
  /** MSAA samples of the composer target (only used on 1x screens: on retina the resolution is enough) */
  samples: number;
  /** EffectComposer (HDR target, GTAO/outline/vignette as passes). false: render straight to the canvas with the
   *  renderer's tone mapping; the outline becomes one blended overlay quad and the vignette a CSS overlay */
  composer: boolean;
  /** HalfFloat render target of the composer (an opt-in pixel/tilt-shift composer on a lighter tier is HalfFloat too:
   *  tone mapping happens in OutputPass, an 8-bit target would clip the highlights first) */
  halfFloat: boolean;
  /** PCF filtering or hard shadows, and the shadow map size */
  shadow: { type: 'pcf' | 'basic'; size: number };
  /** GTAO ambient occlusion pass */
  ao: boolean;
  /** piece outline: masks at full / half resolution, or off */
  outline: 'full' | 'half' | 'off';
  /** vignette as a shader pass (off: a CSS radial-gradient overlay instead) */
  vignette: boolean;
  /** spacing of the terrain heightfield grid (smaller = denser) */
  terrainStep: number;
  /** multiplier of the grass tuft counts */
  grass: number;
  /** share of the decorative props (trees, rocks...) that is placed */
  props: number;
  /** vertex wind sway / cloud shadows / sea foam */
  wind: boolean;
  clouds: boolean;
  foam: boolean;
  /** frames per second of the ambient animations when nobody touches the board (0 = the GPU sits idle) */
  ambientFps: number;
  /** use the 256 px terrain textures when they exist */
  lowTextures: boolean;
  /** terrain normal splat (8 layers) + two-scroll animated sea normals: extra texture reads per pixel and ~11 MB of
   *  GPU memory, so only the two best tiers (a shader define: the other tiers do not compile the code at all) */
  surfaceNormals: boolean;
  /** MSAA of the canvas itself (a context attribute, fixed when the renderer is created). Only for the tier that
   *  renders straight to the canvas but can afford it: high / ultra get MSAA from the composer target, low has none */
  canvasAA: boolean;
}

export const PARAMS: Record<Tier, TierParams> = {
  // PCFSoftShadowMap was removed in three r186: `pcf` is the best filter left
  ultra: { maxPR: 2, samples: 4, composer: true, halfFloat: true, shadow: { type: 'pcf', size: 2048 }, ao: true, outline: 'full', vignette: true, terrainStep: 0.045, grass: 1, props: 1, wind: true, clouds: true, foam: true, ambientFps: 60, lowTextures: false, surfaceNormals: true, canvasAA: false },
  high: { maxPR: 1.5, samples: 4, composer: true, halfFloat: true, shadow: { type: 'pcf', size: 1024 }, ao: false, outline: 'full', vignette: true, terrainStep: 0.06, grass: 0.6, props: 1, wind: true, clouds: true, foam: true, ambientFps: 60, lowTextures: false, surfaceNormals: true, canvasAA: false },
  medium: { maxPR: 1, samples: 2, composer: false, halfFloat: false, shadow: { type: 'basic', size: 1024 }, ao: false, outline: 'half', vignette: true, terrainStep: 0.075, grass: 0.3, props: 0.75, wind: true, clouds: true, foam: true, ambientFps: 30, lowTextures: false, surfaceNormals: false, canvasAA: true },
  low: { maxPR: 0.75, samples: 0, composer: false, halfFloat: false, shadow: { type: 'basic', size: 512 }, ao: false, outline: 'off', vignette: false, terrainStep: 0.1, grass: 0, props: 0.5, wind: false, clouds: false, foam: false, ambientFps: 0, lowTextures: true, surfaceNormals: false, canvasAA: false },
};

/** Number tokens and port signs: GPU quads (labelsprites.ts) on the light tiers, CSS2D DOM labels on high / ultra. */
export const spriteLabels = (t: Tier): boolean => t === 'low' || t === 'medium';

/** What changes the geometry of the island (the static build must be redone when it changes). */
export function detailKey(t: Tier): string {
  const p = PARAMS[t];
  return `${p.terrainStep}/${p.grass}/${p.props}/${p.surfaceNormals ? 'n' : '-'}`;
}

/** The menu / lobby background board: always light, whatever the player chose (never a composer, hard 512
 *  shadows, 30 fps, low terrain detail). At the `low` tier the caller does not build it at all. */
export function dioramaParams(p: TierParams): TierParams {
  return { ...p, maxPR: Math.min(p.maxPR, 1), samples: 0, composer: false, halfFloat: false, shadow: { type: 'basic', size: 512 }, ao: false, outline: 'off', vignette: false,
    terrainStep: Math.max(p.terrainStep, 0.1), grass: 0, props: Math.min(p.props, 0.5), ambientFps: 30, lowTextures: true, surfaceNormals: false, canvasAA: false };
}

// ---------- automatic detection ----------
interface DeviceInfo {
  cores?: number;
  memory?: number; // GB, Chrome caps it at 8
  gpu?: string; // unmasked renderer string
  coarse?: boolean; // touch screen as the main pointer
  width?: number; // CSS px of the short screen side
  maxTexture?: number;
}

// software rasterisers, PowerVR/VideoCore, Mali T/4xx/G31/G51/G52, Adreno 2xx-5xx, Intel HD / old UHD / GMA
const WEAK_GPU = /swiftshader|llvmpipe|softpipe|software|basic render|powervr|videocore|vivante|mali-?4|mali-?t\d|mali-g(31|51|52)\b|adreno[^0-9]*[2-5]\d\d\b|intel.*((?<![a-z])hd graphics|uhd graphics(?! *[7-9])|gma)/i;
const INTEGRATED_GPU = /mali|adreno|iris|uhd graphics|intel|apple a\d|radeon (r[3-7]|vega [3-8]\b)/i;
const STRONG_GPU = /nvidia|geforce|rtx|gtx|radeon (rx|pro)|apple m\d|\barc\b/i;

export function isWeakGpu(gpu: string | undefined): boolean {
  return !!gpu && WEAK_GPU.test(gpu);
}

/** Picks a starting tier from what the browser tells us. Conservative: when in doubt, lighter. */
export function detectTier(d: DeviceInfo): Tier {
  const cores = d.cores ?? 4, mem = d.memory ?? 4, gpu = d.gpu || '';
  if (isWeakGpu(gpu)) return 'low';
  if (d.maxTexture != null && d.maxTexture < 4096) return 'low';
  if (cores <= 2 || mem <= 2) return 'low';
  const small = (d.width ?? 1200) < 700;
  if (d.coarse) {
    // phones and tablets: never above medium; few cores or little memory = weak
    if (cores <= 4 || mem <= 3) return 'low';
    return small || !STRONG_GPU.test(gpu) ? 'medium' : 'high';
  }
  if (STRONG_GPU.test(gpu)) return cores >= 8 && mem >= 8 && !/\barc\b/i.test(gpu) ? 'ultra' : 'high';
  if (INTEGRATED_GPU.test(gpu)) return cores >= 8 && mem >= 8 && /iris xe|apple/i.test(gpu) ? 'high' : 'medium';
  return cores <= 4 || mem <= 4 ? 'medium' : 'high';
}

/** Reads the device (needs a DOM; returns what it can). Creates and frees one throw-away WebGL context. */
export function probeDevice(): DeviceInfo {
  const d: DeviceInfo = {};
  try {
    d.cores = navigator.hardwareConcurrency || undefined;
    d.memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    d.coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    d.width = Math.min(screen.width || innerWidth, screen.height || innerHeight, innerWidth || 9999);
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      d.gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      d.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {}
  return d;
}
