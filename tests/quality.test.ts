// Quality tiers: automatic detection, the table of parameters and the v2 -> v3 settings migration.
import { test, expect } from 'vitest';
import { detectTier, dioramaParams, isWeakGpu, PARAMS, TIERS, detailKey } from '@board/quality';
import { migrate } from '@board/settings';

const ANGLE = (g: string) => `ANGLE (${g}, OpenGL)`;

test('weak GPUs are detected', () => {
  for (const g of ['Intel(R) HD Graphics 4000', 'Intel(R) UHD Graphics 620', 'Mali-T720', 'Mali-G52', 'Adreno (TM) 506', 'PowerVR Rogue GE8320', 'Google SwiftShader', 'llvmpipe (LLVM 15)', 'Microsoft Basic Render Driver'])
    expect(isWeakGpu(ANGLE(g)), g).toBe(true);
  for (const g of ['NVIDIA GeForce RTX 3060', 'Apple M2', 'Adreno (TM) 740', 'Mali-G78', 'Intel(R) Iris(R) Xe Graphics', 'Intel(R) UHD Graphics 770'])
    expect(isWeakGpu(ANGLE(g)), g).toBe(false);
});

test('detectTier: old laptops and cheap phones start on low, strong desktops on ultra', () => {
  expect(detectTier({ cores: 4, memory: 4, gpu: ANGLE('Intel(R) HD Graphics 520') })).toBe('low');
  expect(detectTier({ cores: 8, memory: 8, gpu: 'Mali-G52', coarse: true })).toBe('low');
  expect(detectTier({ cores: 4, memory: 2, coarse: true, gpu: 'Adreno (TM) 619' })).toBe('low');
  expect(detectTier({ cores: 2, gpu: ANGLE('NVIDIA GeForce GTX 1050') })).toBe('low');
  expect(detectTier({ cores: 8, memory: 8, gpu: ANGLE('NVIDIA GeForce RTX 3060') })).toBe('ultra');
  expect(detectTier({ cores: 8, memory: 8, gpu: 'Adreno (TM) 740', coarse: true })).toBe('medium');
  expect(detectTier({ cores: 8, memory: 8, gpu: ANGLE('Intel(R) Iris(R) Plus Graphics') })).toBe('medium');
  expect(detectTier({ cores: 8, memory: 8, gpu: 'x', maxTexture: 2048 })).toBe('low');
});

test('the table gets lighter tier by tier', () => {
  const [u, h, m, l] = TIERS.map(t => PARAMS[t]);
  expect([u!.maxPR, h!.maxPR, m!.maxPR, l!.maxPR]).toEqual([2, 1.5, 1, 0.75]);
  expect([u!.terrainStep, h!.terrainStep, m!.terrainStep, l!.terrainStep]).toEqual([0.045, 0.06, 0.075, 0.1]);
  expect([u!.grass, h!.grass, m!.grass, l!.grass]).toEqual([1, 0.6, 0.3, 0]);
  expect([u!.ambientFps, h!.ambientFps, m!.ambientFps, l!.ambientFps]).toEqual([60, 60, 30, 0]);
  expect([u!.ao, h!.ao, m!.ao, l!.ao]).toEqual([true, false, false, false]);
  expect([u!.composer, h!.composer, m!.composer, l!.composer]).toEqual([true, true, false, false]);
  expect(l!.outline).toBe('off');
  expect(m!.outline).toBe('half');
  expect(detailKey('low')).not.toBe(detailKey('medium'));
  expect([u!.surfaceNormals, h!.surfaceNormals, m!.surfaceNormals, l!.surfaceNormals]).toEqual([true, true, false, false]);
  expect([u!.canvasAA, h!.canvasAA, m!.canvasAA, l!.canvasAA]).toEqual([false, false, true, false]);
  expect(detailKey('high')).not.toBe(detailKey('medium'));
});

test('the menu diorama is always light', () => {
  const d = dioramaParams(PARAMS.ultra);
  expect(d.composer).toBe(false);
  expect(d.ambientFps).toBe(30);
  expect(d.shadow).toEqual({ type: 'basic', size: 512 });
  expect(d.ao).toBe(false);
});

test('settings migration v2 -> v3 keeps the player\'s chips', () => {
  expect(migrate(null)).toBeNull();
  expect(migrate({})).toBeNull();
  expect(migrate({ v: 2, quality: 'high', ao: false, outline: true, pixel: 3, tiltShift: true })).toEqual({ quality: 'high', chosen: true, ao: false, outline: true, pixel: 3, tiltShift: true });
  // v2 low still had the outline and the vignette: it maps to medium, not to the weak-machine tier
  expect(migrate({ v: 2, quality: 'low' })!.quality).toBe('medium');
  expect(migrate({ v: 1, quality: 'high', tiltShift: true })!.tiltShift).toBeUndefined();
  expect(migrate({ v: 3, quality: 'low', chosen: false })).toEqual({ quality: 'low', chosen: false });
  expect(migrate({ v: 3, quality: 'bogus' })!.quality).toBeUndefined();
});
