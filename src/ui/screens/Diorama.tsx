import { useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { SETTINGS } from '@board/settings';

// live 3D island slowly orbiting behind the title. Not built at all on the `low` tier: a static CSS
// gradient instead (class `static`), so the GPU stays idle on the menu.
const isStatic = (): boolean => SETTINGS.quality === 'low';

/** builds the 3D island into `el`; returns a disposer (safe to call before the async build finishes) */
async function buildDiorama(el: HTMLElement, alive: () => boolean): Promise<(() => void) | null> {
  const [{ Board3D }, { createGame }, { defaultConfig }] = await Promise.all([import('@board/Board3D'), import('@engine/game'), import('@engine/config')]);
  if (!alive()) return null;
  const c = defaultConfig();
  c.map.shape = (['pangea', 'big', 'star', 'ring'] as const)[Math.floor(Math.random() * 4)]!;
  c.map.size = 30;
  c.map.gold = 1;
  const st = createGame(c);
  const b = await Board3D.create(el, { diorama: true });
  if (!alive()) {
    b.dispose();
    return null;
  }
  b.render(st as unknown as Parameters<typeof b.render>[0], {});
  b.labels.domElement.style.display = 'none';
  b.controls.enabled = false;
  b.controls.autoRotate = true;
  b.controls.autoRotateSpeed = 0.35;
  b.fpsCap = 30; // the background never needs more
  b.setZoom(1.15);
  return () => b.dispose();
}

export function Diorama(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const low = isStatic();
  useEffect(() => {
    if (low || !ref.current) return;
    let dead = false;
    let dispose: (() => void) | null = null;
    buildDiorama(ref.current, () => !dead).then(d => {
      if (dead && d) d();
      else dispose = d;
    }).catch(e => console.warn('diorama', e));
    return () => {
      dead = true;
      if (dispose) dispose();
    };
  }, [low]);
  return <div ref={ref} class={'menu-bg3d' + (low ? ' static' : '')} />;
}
