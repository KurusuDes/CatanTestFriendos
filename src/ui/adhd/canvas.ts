// Canvas helpers shared by the ADHD machines: canvas(), sprite()/drawSprite() (emoji -> pixel sprite, drawn
// once loaded) and text() with a per-context font cache (assigning g.font every frame re-parses it).
import { pxURL } from '@ui/pixel';
import { h } from './dom';

export type Ctx = CanvasRenderingContext2D;

export function canvas(w: number, hh: number): [HTMLCanvasElement, Ctx] {
  const c = h('canvas', { width: w, height: hh, class: 'adhd-cv' });
  const g = c.getContext('2d') as Ctx;
  g.imageSmoothingEnabled = false;
  return [c, g];
}

// a still machine must repaint once its sprites arrive: the window sets this to "mark every machine dirty"
let onSprite: () => void = () => {};
export function setSpriteHook(fn: () => void): void {
  onSprite = fn;
}

const IMGS: Record<string, HTMLImageElement> = {};
export function sprite(e: string): HTMLImageElement {
  let i = IMGS[e];
  if (!i) {
    i = IMGS[e] = new Image();
    i.onload = () => onSprite();
    i.src = pxURL(e, 32);
  }
  return i;
}

export function drawSprite(g: Ctx, e: string, x: number, y: number, w: number, hh = w): void {
  const i = sprite(e);
  if (i.complete && i.naturalWidth) g.drawImage(i, Math.round(x), Math.round(y), Math.round(w), Math.round(hh));
}

const FONTS = new WeakMap<Ctx, string>();
export function text(g: Ctx, s: string, x: number, y: number, color: string, size = 8): void {
  const font = `800 ${size + 2}px "Baloo 2", sans-serif`;
  if (FONTS.get(g) !== font) {
    FONTS.set(g, font);
    g.font = font;
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#1a1c2c';
  g.fillText(s, x + 1, y + 1);
  g.fillStyle = color;
  g.fillText(s, x, y);
}
