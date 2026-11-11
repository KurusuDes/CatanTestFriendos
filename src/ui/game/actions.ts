// Things the player can do from the game screen (buttons, dev cards, hints...).
import { RES, TILE_INFO, DEV_INFO } from '@engine/constants';
import type { Action, DevType, GameState, Hand } from '@engine/types';
import { hint } from '@engine/bot';
import { App, store } from '@app/index';
import { toast } from '@ui/dom';
import { modal, pick } from './signals';

export const resLine = (o: Partial<Hand>): string => RES.filter(r => o[r]).map(r => `${o[r]}${TILE_INFO[r].icon}`).join(' ');

export const closeModal = (): void => {
  modal.value = null;
};

export function throwDice(v: number, power: number): void {
  const st = store.state.peek();
  if (!st || st.phase !== 'roll' || st.current !== v) return;
  App.dispatch({ type: 'roll', pid: v, power: Math.round(power * 100) / 100 });
}

function describe(a: Action | null, st: GameState): string {
  void st;
  if (!a) return 'Giờ không có gì để làm.';
  switch (a.type) {
    case 'roll': return 'Tung xúc xắc đi.';
    case 'build': return { road: '🛤️ Làm một đoạn đường (chỗ được tô sáng).', settlement: '🏠 Xây một nhà (chỗ được tô sáng).', city: '🏰 Nâng cấp một nhà lên thành phố.' }[a.what];
    case 'buyDev': return '🃏 Mua một thẻ phát triển.';
    case 'bankTrade': return `🏦 Đổi ${TILE_INFO[a.give].icon} lấy ${TILE_INFO[a.get].icon} với ngân hàng.`;
    case 'proposeTrade': return `🤝 Mời người khác đổi ${resLine(a.give)} lấy ${resLine(a.get)}.`;
    case 'playDev': return `Dùng ${DEV_INFO[a.card].icon} ${DEV_INFO[a.card].name}.`;
    case 'endTurn': return '✅ Kết thúc lượt: không còn nước nào hay hơn.';
    default: return a.type;
  }
}

export function showHint(v: number): void {
  const st = store.state.peek();
  if (!st) return;
  const a = hint(st, v) as Action | null;
  toast('💡 ' + describe(a, st), 'info', 3500);
  if (a && a.type === 'build') pick.value = a.what;
}

export function playDev(v: number, type: DevType): void {
  if (type === 'knight' || type === 'roadBuilding') App.dispatch({ type: 'playDev', pid: v, card: type });
  else if (type === 'monopoly') modal.value = { kind: 'monopoly', v };
  else if (type === 'yearOfPlenty') modal.value = { kind: 'yop', v };
}
