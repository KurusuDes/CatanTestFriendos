import { render, type ComponentType } from 'preact';
import { App, type ScreenFn } from '@app/index';

/**
 * Turns a Preact component into an `App.screens[name]` function. The #app root becomes `.nopx`
 * while the screen is up (so pixelize / jitterize never rewrite Preact-owned DOM); `onLeave`
 * unmounts the tree (effect cleanups run: diorama disposal, listeners) and hands the root back.
 */
export function preactScreen<A = undefined>(Screen: ComponentType<{ arg?: A }>): ScreenFn {
  return (root, arg) => {
    root.classList.add('nopx');
    const prev = App.onLeave;
    App.onLeave = () => {
      render(null, root);
      root.classList.remove('nopx');
      if (prev) prev();
    };
    render(<Screen arg={arg as A | undefined} />, root);
  };
}
