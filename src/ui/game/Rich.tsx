import type { ComponentChildren, JSX } from 'preact';
import { TILE_INFO } from '@engine/constants';
import type { Player, Res } from '@engine/types';
import { PixelIcon, px } from '@ui/components/PixelIcon';

const RE = /@(\d+)|:(wood|brick|sheep|wheat|ore):/g;

/** "@2 cướp :wood:" -> coloured player name + resource sprite (emoji in the plain text become sprites too) */
export function Rich({ msg, players, size = 16 }: { msg: string; players: readonly Pick<Player, 'name' | 'color'>[]; size?: number }): JSX.Element {
  const out: ComponentChildren[] = [];
  let last = 0;
  RE.lastIndex = 0;
  for (let m = RE.exec(msg); m; m = RE.exec(msg)) {
    if (m.index > last) out.push(...px(msg.slice(last, m.index), size));
    if (m[1] != null) {
      const p = players[+m[1]];
      out.push(<b class="pname" style={{ '--pc': p ? p.color : '#fff' }}>{p ? p.name : '?'}</b>);
    } else {
      const info = TILE_INFO[m[2] as Res];
      out.push(<span class="ico" title={info.name}><PixelIcon emoji={info.icon} size={size} /></span>);
    }
    last = RE.lastIndex;
  }
  if (last < msg.length) out.push(...px(msg.slice(last), size));
  return <>{out}</>;
}
