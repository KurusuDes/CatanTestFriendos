// Fog of war: a 512² mask texture (white = seen) sampled by every patched material, and the
// visibility of the CSS2D labels.
import { U } from './shaders';
import type { BState, BoardViewState } from './types';
import type { Board3D } from './Board3D';

export function updateFog(b: Board3D, st: BState, view: BoardViewState): void {
  const vis = view.vision;
  U.uFogOn.value = vis ? 1 : 0;
  if (!vis) return;
  const bd = st.board.bounds;
  const pad = 8;
  const rect = { x: bd.minX - pad, z: bd.minY - pad, w: bd.maxX - bd.minX + pad * 2, h: bd.maxY - bd.minY + pad * 2 };
  U.uFogRect.value.set(rect.x, rect.z, rect.w, rect.h);
  const c = b.fogCanvas, g = c.getContext('2d', { willReadFrequently: true })!;
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
  b.fogTex.needsUpdate = true;
  const lit = (x: number, z: number) => {
    const px = Math.floor((x - rect.x) * sx), pz = Math.floor((z - rect.z) * sz);
    return g.getImageData(Math.max(0, Math.min(511, px)), Math.max(0, Math.min(511, pz)), 1, 1).data[0]! > 90;
  };
  b.staticGroup.traverse(o => {
    if ((o as any).isCSS2DObject) o.visible = lit(o.position.x, o.position.z);
  });
}
