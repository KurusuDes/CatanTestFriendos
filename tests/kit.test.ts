// kit.glb nén meshopt phải tương đương bản gốc trong tools/source (cấu trúc, vật liệu, đỉnh, bbox).
import { test, expect } from 'vitest';
import { verifyKit } from '../scripts/verify-kit.ts';

test('kit.glb nén tương đương bản gốc', async () => {
  const r = await verifyKit('tools/source/kit.glb', 'public/assets/models/kit.glb');
  expect(r.errors).toEqual([]);
  expect(r.meshes).toBeGreaterThan(0);
}, 60000);
