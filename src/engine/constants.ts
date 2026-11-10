import type { Res, Hand, TileKind, DevType, DevDeckId, EventId } from './types';

export const RES: readonly Res[] = ['wood', 'brick', 'sheep', 'wheat', 'ore'];

export const isRes = (x: unknown): x is Res => (RES as readonly unknown[]).includes(x);

/** Object.entries for a (partial) hand/cost with the keys typed as resources. */
export const resEntries = (h: Partial<Hand>): [Res, number][] => Object.entries(h) as [Res, number][];

export const TILE_INFO: Record<TileKind, { name: string; icon: string; color: string; dark: string }> = {
  wood: { name: 'Gỗ', icon: '🌲', color: '#3d8b3d', dark: '#23602a' },
  brick: { name: 'Gạch', icon: '🧱', color: '#c9643a', dark: '#8f3d1d' },
  sheep: { name: 'Cừu', icon: '🐑', color: '#9ccc65', dark: '#5f8f2f' },
  wheat: { name: 'Lúa', icon: '🌾', color: '#f0c541', dark: '#b88a12' },
  ore: { name: 'Đá', icon: '⛰️', color: '#8d93a3', dark: '#555b6b' },
  desert: { name: 'Sa mạc', icon: '🌵', color: '#e6d197', dark: '#b39b5c' },
  gold: { name: 'Vàng', icon: '💰', color: '#ffb300', dark: '#b37400' },
};

export const COSTS: Record<'road' | 'settlement' | 'city' | 'dev', Partial<Hand>> = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 },
  dev: { sheep: 1, wheat: 1, ore: 1 },
};

export const DEV_INFO: Record<DevType, { name: string; icon: string; desc: string }> = {
  knight: { name: 'Hiệp sĩ', icon: '⚔️', desc: 'Di chuyển kẻ trộm và cướp một thẻ.' },
  roadBuilding: { name: 'Xây đường', icon: '🛤️', desc: 'Xây 2 đoạn đường miễn phí.' },
  yearOfPlenty: { name: 'Năm bội thu', icon: '🎁', desc: 'Lấy 2 tài nguyên từ ngân hàng.' },
  monopoly: { name: 'Độc quyền', icon: '👑', desc: 'Mọi người đưa bạn một loại tài nguyên.' },
  vp: { name: 'Điểm chiến thắng', icon: '🏆', desc: '+1 điểm (giấu kín).' },
};

export const DEV_DECKS: Record<DevDeckId, { name: string } & Record<DevType, number>> = {
  normal: { name: 'Bình thường', knight: 14, vp: 5, roadBuilding: 2, yearOfPlenty: 2, monopoly: 2 },
  war: { name: 'Chiến tranh (nhiều hiệp sĩ)', knight: 24, vp: 3, roadBuilding: 1, yearOfPlenty: 1, monopoly: 1 },
  progress: { name: 'Tiến bộ (nhiều thẻ tiến bộ)', knight: 10, vp: 5, roadBuilding: 5, yearOfPlenty: 5, monopoly: 4 },
  none: { name: 'Không có thẻ phát triển', knight: 0, vp: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 },
};

export const EVENTS: { id: EventId; name: string; icon: string; desc: string }[] = [
  { id: 'bonanza', name: 'Được mùa', icon: '🌟', desc: 'Vòng này sản lượng gấp đôi.' },
  { id: 'drought', name: 'Hạn hán', icon: '☀️', desc: 'Vòng này có một tài nguyên không được sản xuất.' },
  { id: 'fairTrade', name: 'Buôn bán sòng phẳng', icon: '⚖️', desc: 'Vòng này ngân hàng đổi 3:1.' },
  { id: 'blackMarket', name: 'Chợ đen', icon: '🕶️', desc: 'Vòng này có một tài nguyên được đổi 2:1.' },
  { id: 'earthquake', name: 'Động đất', icon: '🌋', desc: 'Hai ô số đổi chỗ cho nhau.' },
  { id: 'storm', name: 'Bão', icon: '🌪️', desc: 'Kẻ trộm bay sang ô khác.' },
  { id: 'gift', name: 'Quà của vua', icon: '🎁', desc: 'Ai cũng nhận 1 tài nguyên ngẫu nhiên.' },
  { id: 'plague', name: 'Dịch bệnh', icon: '🦠', desc: 'Ai có từ 6 thẻ trở lên mất ngẫu nhiên 1 thẻ.' },
  { id: 'tax', name: 'Thu thuế', icon: '💸', desc: 'Người dẫn đầu nộp 1 thẻ cho ngân hàng.' },
  { id: 'rebellion', name: 'Nổi dậy', icon: '✊', desc: 'Người xếp cuối được nhận 2 tài nguyên.' },
  { id: 'calm', name: 'Yên bình', icon: '🍃', desc: 'Chưa có gì xảy ra... tạm thời thôi.' },
];

export const pips = (n: number | null): number => (n ? 6 - Math.abs(7 - n) : 0);
// probability bar under a number token: one segment per classic Catan pip, centred, thicker
// and going white -> grey -> black -> red (6 and 8, the hot numbers) the likelier the number
const PROB_COLOR: string[] = ['', '#f4f4f4', '#b3ab9b', '#6b665d', '#1a1c2c', '#d62f2f'];
export const probLook = (n: number | null) => {
  const p = pips(n);
  return { p, h: Math.max(3, p + 1), c: PROB_COLOR[p] || '' };
};
