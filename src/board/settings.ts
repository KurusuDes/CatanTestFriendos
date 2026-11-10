// Graphics settings (persisted in localStorage under `katanittes.gfx`, version 3).
// v3: `quality` is one of four tiers (see quality.ts), picked automatically on the first run.
// v2: quality 'high' | 'low'. 'high' stays 'high'; 'low' becomes 'medium' (v2 low kept the outline,
// the vignette and the HalfFloat target, so it was never the weak-machine preset).
import { detectTier, PARAMS, probeDevice, TIERS, type Tier, type TierParams } from './quality';

export type Quality = Tier;
export interface Settings {
  v: number;
  pixel: number;
  tiltShift: boolean;
  quality: Quality;
  ao: boolean;
  outline: boolean;
  /** true once the player picked the tier by hand (false: it came from the automatic detection) */
  chosen: boolean;
}

export const SETTINGS: Settings = { v: 3, pixel: 1, tiltShift: false, quality: 'high', ao: true, outline: true, chosen: false };

/** Migrates whatever is stored (v1/v2/v3 or garbage) to the v3 shape. Pure: used by the tests. */
export function migrate(saved: Record<string, unknown> | null | undefined): Partial<Settings> | null {
  if (!saved || typeof saved !== 'object' || !Object.keys(saved).length) return null;
  const out: Partial<Settings> = {};
  if (typeof saved.pixel === 'number') out.pixel = saved.pixel;
  if (typeof saved.ao === 'boolean') out.ao = saved.ao;
  if (typeof saved.outline === 'boolean') out.outline = saved.outline;
  // the tilt-shift started off in v2: older saves drop it
  if (typeof saved.tiltShift === 'boolean' && (saved.v as number) >= 2) out.tiltShift = saved.tiltShift;
  const q = saved.quality;
  if (saved.v === 3) {
    if (typeof q === 'string' && (TIERS as string[]).includes(q)) (out.quality = q as Tier), (out.chosen = saved.chosen === true);
  } else if (q === 'high') (out.quality = 'high'), (out.chosen = true);
  else if (q === 'low') (out.quality = 'medium'), (out.chosen = true);
  return out;
}

try {
  const raw = localStorage.getItem('katanittes.gfx');
  const m = raw ? migrate(JSON.parse(raw)) : null;
  if (m) Object.assign(SETTINGS, m);
  if (!m || !m.quality) {
    // first run (or a save without a tier): look at the machine
    SETTINGS.quality = detectTier(probeDevice());
    SETTINGS.chosen = false;
    if (SETTINGS.quality === 'low') SETTINGS.ao = false;
  }
  SETTINGS.v = 3;
  if (!raw || (JSON.parse(raw) as { v?: number }).v !== 3) saveSettings();
} catch {}

export function saveSettings(): void {
  try {
    localStorage.setItem('katanittes.gfx', JSON.stringify(SETTINGS));
  } catch {}
}

/** Parameters of the current tier with the player's own chips applied (ambient occlusion, outline). */
export function effective(s: Settings = SETTINGS): TierParams {
  const p = PARAMS[s.quality] || PARAMS.high;
  return { ...p, ao: p.ao && s.ao, outline: s.outline ? p.outline : 'off', shadow: { ...p.shadow } };
}

/** `lowfx` on <html> turns the decorative CSS animations off (see pixel.css). */
export function applyLowFx(tier: Tier = SETTINGS.quality): void {
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('lowfx', tier === 'low');
}
applyLowFx();
