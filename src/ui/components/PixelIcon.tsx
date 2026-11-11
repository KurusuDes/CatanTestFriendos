// Preact twin of @ui/pixel: the same sprite <img> that `pixelize` swaps in for an emoji. Preact screens
// live inside a `.nopx` root (pixelize skips it), so they render the sprites themselves.
import type { ComponentChildren, JSX } from 'preact';
import { pxURL } from '@ui/pixel';
import { iconSetSignal } from '@ui/iconset';

const EMOJI = /(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*️?|[⭐✨])/gu;

export interface PixelIconProps {
  emoji: string;
  /** px, = round(parent font-size * 1.15) like pixelize does */
  size?: number;
  class?: string;
}

export function PixelIcon({ emoji, size = 20, class: cls }: PixelIconProps): JSX.Element {
  void iconSetSignal.value; // re-render when the icon set changes (game menu)
  const name = emoji.replace(/️/g, '');
  return <img class={cls ? `px ${cls}` : 'px'} src={pxURL(name, size)} width={size} height={size} alt={emoji} draggable={false} />;
}

/** "🎮 Chơi thôi!" -> [<PixelIcon 🎮/>, " Chơi thôi!"]: use inside any element, `size` as for PixelIcon */
export function px(text: string, size = 20): ComponentChildren[] {
  return text.split(EMOJI).map((part, i) => (i % 2 === 1 ? <PixelIcon emoji={part} size={size} /> : part)).filter(p => p !== '');
}

/** component form of px(): <Emo size={22}>🏰 Phòng</Emo> */
export function Emo({ size = 20, children }: { size?: number; children: string }): JSX.Element {
  return <>{px(children, size)}</>;
}

/** font-size (px) -> sprite size, same rule as pixelize */
export const spriteSize = (fontPx: number): number => Math.round(fontPx * 1.15);
