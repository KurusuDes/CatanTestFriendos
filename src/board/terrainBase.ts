// Hằng số, kiểu và hàm nhiễu/prng dùng chung của việc sinh địa hình (tách ra để terrainGen, propsGen, grassGen không import vòng).
import { pixelToHex as pixelToHexJs } from '@engine/board';

export interface GenTile {
  id: number;
  q: number;
  r: number;
  x: number;
  y: number;
  res: string;
  revealed: boolean;
}
export interface GenBounds { minX: number; maxX: number; minY: number; maxY: number }
export interface GenInput {
  tiles: GenTile[];
  vertices: { x: number; y: number }[];
  edges: { a: number; b: number }[];
  bounds: GenBounds;
  faceDown: boolean;
  /** tier params: terrain grid spacing, grass tuft multiplier, share of decorative props */
  step: number;
  grass: number;
  props: number;
}

export const pixelToHex = (x: number, z: number) => pixelToHexJs(x, z) as [number, number];

export const INR = Math.sqrt(3) / 2; // hex inradius
export const NORMALS = [0, 1, 2].map((k): [number, number] => [Math.cos((k * Math.PI) / 3), Math.sin((k * Math.PI) / 3)]);
export const L = { grass: 0, forest: 1, dirt: 2, rock: 3, sand: 4, snow: 5, field: 6, meadow: 7 };
export type RGB = [number, number, number];
// linear-RGB values of the former THREE.Color('#ffa488') etc.
export const TINT: { [kind: string]: RGB | undefined; white: RGB } = {
  brick: [1, 0.3712376804636741, 0.24620132669705552],
  desert: [0.9046611743890203, 0.8387990117372213, 0.76052450467022],
  back: [0.48514994004665124, 0.3139887133649649, 0.17144110072255403],
  unknown: [0.3231432091022285, 0.36625259558833256, 0.33245153633549385],
  gold: [0.8713671191959567, 0.6444796819634361, 0.19461783043107173],
  white: [1, 1, 1],
};

// ---------- noise ----------
function hash2(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export const fbm = (x: number, y: number) => vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.28 + vnoise(x * 4.3, y * 4.3) * 0.17;
export const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export function prng(seed: number) {
  let s = (Math.abs(seed | 0) % 233280) + 1;
  return () => (s = (s * 9301 + 49297) % 233280) / 233280;
}

// ---------- tile looks: 5 variations per resource ----------
// Which looks each resource may use. A tile's look comes from its id and position, so every player
// sees the same map. LOOK_OVERRIDE forces one look for a resource (samples, debugging).
export const TILE_LOOKS: Record<string, number[]> = { wood: [0, 1, 2, 3], sheep: [0, 1, 2, 3, 4], wheat: [0, 1, 2, 4], brick: [0, 1, 2, 3, 4], ore: [0, 1, 2, 3, 4] };
export const LOOK_OVERRIDE: Record<string, number> = {};
export function tileLook(res: string, seed: number) {
  if (LOOK_OVERRIDE[res] != null) return LOOK_OVERRIDE[res];
  const list = TILE_LOOKS[res];
  return list && list.length ? list[(Math.imul(seed, 2654435761) >>> 0) % list.length] : 0;
}
