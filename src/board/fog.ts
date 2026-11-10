// Fog of war: a 512² mask texture (white = seen) sampled by every patched material, and the
// visibility of the CSS2D labels. Both only change when the vision itself changes.
import { visibility } from '@engine/game';
import { U } from './shaders';
import type { BBounds, BState, BoardViewState, Vision } from './types';
import type { Board3D } from './Board3D';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Identity of a vision (circles + caps, rounded to 1/100 unit) over a map of those bounds. */
export function visionKey(vis: Vision, bd: BBounds): string {
  return [
    vis.circles.map(c => c.map(r2).join(',')).join(';'),
    vis.caps.map(c => c.map(r2).join(',')).join(';'),
    [bd.minX, bd.maxX, bd.minY, bd.maxY].map(r2).join(','),
  ].join('|');
}

export function updateFog(b: Board3D, st: BState, view: BoardViewState): void {
  const vis = view.vision;
  U.uFogOn.value = vis ? 1 : 0;
  if (!vis) return;
  const bd = st.board.bounds;
  const pad = 8;
  const rect = { x: bd.minX - pad, z: bd.minY - pad, w: bd.maxX - bd.minX + pad * 2, h: bd.maxY - bd.minY + pad * 2 };
  U.uFogRect.value.set(rect.x, rect.z, rect.w, rect.h);
  const c = b.fogCanvas;
  const sx = c.width / rect.w, sz = c.height / rect.h;
  const key = visionKey(vis, bd);
  if (key !== b.fogKey) {
    // the 512² redraw with a blur filter is the expensive part: only when the vision changed
    b.fogKey = key;
    const g = c.getContext('2d')!;
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
  }
  // label visibility: pure maths instead of reading the canvas back. The old test was "red channel
  // of the blurred mask > 90/255"; a blur of sigma s puts that level 0.377 s outside the geometric
  // edge, so visibility() (> 0 = inside the lit area) is compared against that small negative margin.
  const labelKey = key + '#' + b.labelRev;
  if (labelKey === b.fogLabelKey) return;
  b.fogLabelKey = labelKey;
  const sigma = Math.max(2, Math.round(sx * 0.16)) / sx;
  const edge = -0.377 * sigma;
  b.staticGroup.traverse(o => {
    if ((o as any).isCSS2DObject) o.visible = visibility(vis, o.position.x, o.position.z) > edge;
  });
}
