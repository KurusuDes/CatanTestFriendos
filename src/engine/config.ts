import { newSeed } from './rng';
import type { Config, Mode, Preset } from './types';

export const PLAYER_COLORS: string[] = ['#e53935', '#1e88e5', '#ff9800', '#f5f5f5', '#43a047', '#8e24aa', '#00acc1', '#795548'];
export const BOT_NAMES: string[] = ['Cô Tiều', 'Ngài Gạch', 'Ông Ngân Hàng', 'Chú Lúa', 'Bé Cừu', 'Người Đá', 'Bà Đất Sét', 'Trộm Vặt'];

export function defaultConfig(): Config {
  return {
    seed: newSeed(),
    players: [
      { name: 'Bạn', kind: 'human', color: PLAYER_COLORS[0]! },
      { name: BOT_NAMES[0]!, kind: 'bot', level: 'normal', color: PLAYER_COLORS[1]! },
      { name: BOT_NAMES[1]!, kind: 'bot', level: 'normal', color: PLAYER_COLORS[2]! },
      { name: BOT_NAMES[2]!, kind: 'bot', level: 'normal', color: PLAYER_COLORS[3]! },
    ],
    map: { shape: 'classic', size: 24, resources: 'balanced', numbers: 'balanced', deserts: 'auto', gold: 0, ports: 'normal', custom: null },
    rules: {
      vpTarget: 10, handLimit: 7, setupRounds: 2, setupCity: false, friendlyRobber: false, robberGrace: 0,
      startBonus: 0, productionMult: 1, devDeck: 'normal', diceMode: 'random',
      maxRoads: 15, maxSettlements: 5, maxCities: 4, randomStart: true, noRobber: false,
    },
    modes: { flipped: false, blindfold: false, fog: false, hiddenNumbers: false, events: false, chaosEvery: 0, chaosWhat: 'numbers', privacy: 'auto' },
  };
}

// Toggleable game modes shown in the lobby. `apply` receives the config.
export const MODES: Mode[] = [
  { id: 'flipped', icon: '🙈', name: 'Bịt mắt: úp bàn cờ', flagship: true, desc: 'Mọi ô đều bị úp. Bạn đặt nhà mà không biết bên dưới là gì (người khác vẫn thấy nhà bạn), đặt xong thì cả bàn cờ được lật lên.', get: c => c.modes.flipped, set: (c, v) => (c.modes.flipped = v) },
  { id: 'fog', icon: '🌑', name: 'Sương mù chiến tranh', flagship: true, desc: 'Tối om: bạn chỉ thấy quanh nhà mình và nửa ô hai bên đường của mình. Nếu xây trúng chỗ đã có người mà bạn không thấy, công trình sẽ dời sang chỗ trống gần nhất.', get: c => c.modes.fog, set: (c, v) => (c.modes.fog = v) },
  { id: 'blindfold', icon: '🤫', name: 'Nhà bí mật', desc: 'Không ai thấy người khác đặt nhà đầu ván ở đâu cho tới lúc lật mở. Nếu trùng chỗ, người đặt sau phải dời đi.', get: c => c.modes.blindfold, set: (c, v) => (c.modes.blindfold = v) },
  { id: 'hiddenNumbers', icon: '❓', name: 'Số bí mật', desc: 'Bạn thấy tài nguyên, nhưng số chỉ hiện ra khi bạn xây sát bên.', get: c => c.modes.hiddenNumbers, set: (c, v) => (c.modes.hiddenNumbers = v) },
  { id: 'events', icon: '🎲', name: 'Sự kiện mỗi vòng', desc: 'Mỗi vòng có một sự kiện: hạn hán, động đất, chợ đen, bão, dịch bệnh...', get: c => c.modes.events, set: (c, v) => (c.modes.events = v) },
  { id: 'chaos', icon: '🌀', name: 'Đất chuyển mình', desc: 'Cứ 3 vòng, số (hoặc tài nguyên) trên bản đồ lại bị xáo trộn.', get: c => c.modes.chaosEvery > 0, set: (c, v) => (c.modes.chaosEvery = v ? 3 : 0) },
  { id: 'balancedDice', icon: '🃏', name: 'Xúc xắc cân bằng', desc: 'Kết quả xúc xắc rút từ bộ 36 lá: xác suất luôn đúng như lý thuyết.', get: c => c.rules.diceMode === 'balanced', set: (c, v) => (c.rules.diceMode = v ? 'balanced' : 'random') },
  { id: 'friendlyRobber', icon: '😇', name: 'Kẻ trộm hiền lành', desc: 'Kẻ trộm không được nhắm vào người có từ 2 điểm trở xuống.', get: c => c.rules.friendlyRobber, set: (c, v) => (c.rules.friendlyRobber = v) },
  { id: 'noRobber', icon: '🚫', name: 'Không có kẻ trộm', desc: 'Ra 7 thì chỉ phải bỏ thẻ. Không ai bị cướp.', get: c => c.rules.noRobber, set: (c, v) => (c.rules.noRobber = v) },
  { id: 'setupCity', icon: '🏰', name: 'Khởi đầu bằng thành phố', desc: 'Lần đặt thứ hai đầu ván là thành phố luôn.', get: c => c.rules.setupCity, set: (c, v) => (c.rules.setupCity = v) },
  { id: 'doubleProd', icon: '⚡', name: 'Tăng tốc', desc: 'Sản lượng luôn gấp đôi. Ván nào cũng bùng nổ.', get: c => c.rules.productionMult > 1, set: (c, v) => (c.rules.productionMult = v ? 2 : 1) },
];

export const PRESETS: Preset[] = [
  { id: 'classic', icon: '🏝️', name: 'Cổ điển', desc: 'Luật chơi quen thuộc.', apply: c => {} },
  { id: 'blind', icon: '🙈', name: 'Bịt mắt', desc: 'Úp bàn cờ trong lúc đặt nhà đầu ván.', apply: c => { c.modes.flipped = true; } },
  { id: 'fog', icon: '🌑', name: 'Sương mù chiến tranh', desc: 'Chỉ thấy quanh mình, xung quanh tối om.', apply: c => { c.modes.fog = true; c.map.shape = 'big'; } },
  { id: 'explorer', icon: '🧭', name: 'Nhà thám hiểm', desc: 'Sương mù chiến tranh trên quần đảo.', apply: c => { c.modes.fog = true; c.map.shape = 'islands'; c.map.size = 27; } },
  { id: 'paranoia', icon: '😱', name: 'Hoang tưởng', desc: 'Bịt mắt + sương mù + nhà bí mật.', apply: c => { c.modes.flipped = true; c.modes.fog = true; c.modes.blindfold = true; } },
  { id: 'chaos', icon: '🌀', name: 'Hỗn loạn', desc: 'Sự kiện, đất chuyển mình, tài nguyên hỗn loạn và vàng.', apply: c => { c.modes.events = true; c.modes.chaosEvery = 3; c.map.resources = 'chaos'; c.map.gold = 2; c.map.shape = 'pangea'; } },
  { id: 'speed', icon: '⚡', name: 'Ván nhanh', desc: 'Chơi tới 7 điểm, sản lượng gấp đôi, có quà khởi đầu.', apply: c => { c.rules.vpTarget = 7; c.rules.productionMult = 2; c.rules.startBonus = 1; } },
  { id: 'war', icon: '⚔️', name: 'Chiến tranh', desc: 'Bộ thẻ toàn hiệp sĩ và kẻ trộm không nương tay.', apply: c => { c.rules.devDeck = 'war'; c.rules.startBonus = 1; } },
];
