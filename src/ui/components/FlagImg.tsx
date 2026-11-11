import type { JSX } from 'preact';
import { flagURL, isGrid } from '@ui/flag/flag';

export function FlagImg({ flag, size = 24, class: cls = 'flag-img' }: { flag: unknown; size?: number; class?: string }): JSX.Element {
  return <img src={flagURL(flag)} width={Math.round(size * 1.5)} height={size} class={cls + (isGrid(flag) ? ' pixel' : '')} alt="cờ" draggable={false} />;
}

/** a banner on its pole (the little waving flag used on the menu, hub and lobby) */
export function FlagPole({ flag, size, class: cls = 'hub-flag', imgClass = 'flag-img wave', onClick, title }: {
  flag: unknown; size: number; class?: string; imgClass?: string; onClick?: () => void; title?: string;
}): JSX.Element {
  const inner = (
    <>
      <div class="pole" />
      <FlagImg flag={flag} size={size} class={imgClass} />
    </>
  );
  return onClick ? <button class={cls} title={title} onClick={onClick}>{inner}</button> : <div class={cls}>{inner}</div>;
}
