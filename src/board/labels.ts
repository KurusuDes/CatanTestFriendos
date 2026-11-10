// Pixel-art CSS2D labels: number tokens, face-down runes (and the port signs, see ports.ts).
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { probLook } from '@engine/constants';
import { disposeTree } from './dispose';
import type { BBoard, BState } from './types';
import type { Board3D } from './Board3D';

export function css2d(cls: string, html: string, tag = 'div'): CSS2DObject {
  const el = document.createElement(tag);
  el.className = cls;
  if (html) el.innerHTML = html;
  return new CSS2DObject(el);
}

/** Changes only when a number (or whether it is shown) changes: rebuilds just the token labels. */
export function tokenKey(bd: BBoard): string {
  return bd.tiles.map(t => `${t.num}${t.numRevealed ? 1 : 0}`).join('|');
}

/** (Re)builds the number tokens and face-down runes into a fresh group under the static group. */
export function buildTokens(b: Board3D, st: BState, faceDown: boolean): void {
  const bd = st.board;
  if (b.tokenGroup) {
    b.staticGroup.remove(b.tokenGroup);
    disposeTree(b.tokenGroup);
  }
  const group = (b.tokenGroup = new THREE.Group());
  b.staticGroup.add(group);
  b.tokens = [];
  b.labelRev++; // the labels are new: fog visibility has to be applied to them again
  const field = b.field!;
  // ---- tokens + face-down runes (pixel UI labels)
  for (const t of bd.tiles) {
    const h = field.sample(t.x, t.y);
    if (!t.revealed) {
      if (faceDown) {
        const rune = css2d('rune3d', '✦');
        rune.position.set(t.x, h + 0.05, t.y);
        group.add(rune);
      }
      continue;
    }
    if (t.res === 'desert') continue;
    const red = t.numRevealed && (t.num === 6 || t.num === 8);
    const pl = probLook(t.num);
    // the label is a bare anchor (CSS2DRenderer owns its transform); the token inside scales with the zoom
    const face = t.numRevealed ? `<span>${t.num}</span><i class="pbar">${`<b style="height:${pl.h}px;background:${pl.c}"></b>`.repeat(pl.p)}</i>` : '<span>?</span>';
    const tok = css2d('tok3d-at', `<div class="tok3d${red ? ' red' : ''}">${face}</div>`);
    tok.position.set(t.x, Math.max(h, 0.3) + 0.12, t.y);
    tok.userData.num = t.numRevealed ? t.num : null;
    b.tokens.push(tok);
    group.add(tok);
  }
}
