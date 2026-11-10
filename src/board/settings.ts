// Graphics settings (persisted in localStorage under `katanittes.gfx`).
export type Quality = 'high' | 'low';
export interface Settings {
  v: number;
  pixel: number;
  tiltShift: boolean;
  quality: Quality;
  ao: boolean;
  outline: boolean;
}

// v2: the tilt-shift starts off (it made the whole map look blurry); older saves drop it
export const SETTINGS: Settings = { v: 2, pixel: 1, tiltShift: false, quality: 'high', ao: true, outline: true };
// phones and small screens start on the light preset
if (typeof matchMedia === 'function' && (matchMedia('(pointer: coarse)').matches || innerWidth < 900)) Object.assign(SETTINGS, { quality: 'low', ao: false });
try {
  const saved = JSON.parse(localStorage.getItem('katanittes.gfx') || '{}');
  if (saved.v !== 2) delete saved.tiltShift;
  Object.assign(SETTINGS, saved, { v: 2 });
} catch {}

export function saveSettings(): void {
  try {
    localStorage.setItem('katanittes.gfx', JSON.stringify(SETTINGS));
  } catch {}
}
