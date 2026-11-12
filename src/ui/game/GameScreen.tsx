// The in-game screen: top bar, map + side panel (players, bank, log), action bar, windows and floating layers.
// Registered as `App.screens.game` through `preactScreen`; the controller (effects + listeners) lives
// exactly as long as the screen.
import type { JSX } from 'preact';
import { App, type ScreenFn } from '@app/index';
import { preactScreen } from '@ui/components/mount';
import { ActionBar } from './ActionBar';
import { BoardHost } from './BoardHost';
import { Announces, Confetti, PassScreen } from './Floating';
import { Log } from './Log';
import { ModalHost } from './Modals';
import { Bank, Players } from './Players';
import { TopBar } from './TopBar';
import { startController } from './controller';
import { countRender } from './signals';

function GameScreen(): JSX.Element {
  countRender('GameScreen');
  return (
    <>
      <div class="game screen">
        <TopBar />
        <main class="game-main">
          <BoardHost />
          <aside class="side">
            <Players />
            <Bank />
            <Log />
          </aside>
        </main>
        <ActionBar />
      </div>
      <div><ModalHost /></div>
      <PassScreen />
      <Announces />
      <Confetti />
    </>
  );
}

const mount = preactScreen(GameScreen);

export const gameScreen: ScreenFn = (root, arg) => {
  const stop = startController();
  mount(root, arg);
  const unmount = App.onLeave; // set by preactScreen: unmounts the tree
  App.onLeave = () => {
    if (unmount) unmount(); // BoardHost's cleanup disposes the board and the arcade
    stop();
  };
};
