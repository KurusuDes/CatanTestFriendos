export const RES = ['wood', 'brick', 'sheep', 'wheat', 'ore'];

export const TILE_INFO = {
  wood: { name: 'Madera', icon: '🌲', color: '#3d8b3d', dark: '#23602a' },
  brick: { name: 'Arcilla', icon: '🧱', color: '#c9643a', dark: '#8f3d1d' },
  sheep: { name: 'Lana', icon: '🐑', color: '#9ccc65', dark: '#5f8f2f' },
  wheat: { name: 'Trigo', icon: '🌾', color: '#f0c541', dark: '#b88a12' },
  ore: { name: 'Mineral', icon: '⛰️', color: '#8d93a3', dark: '#555b6b' },
  desert: { name: 'Desierto', icon: '🌵', color: '#e6d197', dark: '#b39b5c' },
  gold: { name: 'Oro', icon: '💰', color: '#ffb300', dark: '#b37400' },
};

export const COSTS = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 },
  dev: { sheep: 1, wheat: 1, ore: 1 },
};

export const DEV_INFO = {
  knight: { name: 'Caballero', icon: '⚔️', desc: 'Mueve el ladrón y roba una carta.' },
  roadBuilding: { name: 'Construir caminos', icon: '🛤️', desc: 'Construye 2 caminos gratis.' },
  yearOfPlenty: { name: 'Año de abundancia', icon: '🎁', desc: 'Toma 2 recursos del banco.' },
  monopoly: { name: 'Monopolio', icon: '👑', desc: 'Todos te dan un recurso.' },
  vp: { name: 'Punto de victoria', icon: '🏆', desc: '+1 punto (oculto).' },
};

export const DEV_DECKS = {
  normal: { name: 'Normal', knight: 14, vp: 5, roadBuilding: 2, yearOfPlenty: 2, monopoly: 2 },
  war: { name: 'Guerra (muchos caballeros)', knight: 24, vp: 3, roadBuilding: 1, yearOfPlenty: 1, monopoly: 1 },
  progress: { name: 'Progreso (muchas cartas de progreso)', knight: 10, vp: 5, roadBuilding: 5, yearOfPlenty: 5, monopoly: 4 },
  none: { name: 'Sin cartas de desarrollo', knight: 0, vp: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0 },
};

export const EVENTS = [
  { id: 'bonanza', name: 'Cosecha abundante', icon: '🌟', desc: 'Esta ronda la producción es doble.' },
  { id: 'drought', name: 'Sequía', icon: '☀️', desc: 'Un recurso no se produce esta ronda.' },
  { id: 'fairTrade', name: 'Comercio justo', icon: '⚖️', desc: 'El banco cambia 3:1 esta ronda.' },
  { id: 'blackMarket', name: 'Mercado negro', icon: '🕶️', desc: 'Un recurso se cambia 2:1 esta ronda.' },
  { id: 'earthquake', name: 'Terremoto', icon: '🌋', desc: 'Dos fichas de número se intercambian.' },
  { id: 'storm', name: 'Tormenta', icon: '🌪️', desc: 'El ladrón sale volando a otra casilla.' },
  { id: 'gift', name: 'Regalo del rey', icon: '🎁', desc: 'Todos reciben 1 recurso al azar.' },
  { id: 'plague', name: 'Plaga', icon: '🦠', desc: 'Quien tenga 6+ cartas pierde 1 al azar.' },
  { id: 'tax', name: 'Impuestos', icon: '💸', desc: 'El líder paga 1 carta al banco.' },
  { id: 'rebellion', name: 'Rebelión', icon: '✊', desc: 'El que va último recibe 2 recursos.' },
  { id: 'calm', name: 'Calma', icon: '🍃', desc: 'No pasa nada... por ahora.' },
];

export const pips = n => (n ? 6 - Math.abs(7 - n) : 0);
// probability bar under a number token: grows from the centre, gets thicker and goes
// white -> grey -> black -> red (6 and 8, the hot numbers)
const PROB_COLOR = ['', '#f4f4f4', '#b3ab9b', '#6b665d', '#1a1c2c', '#d62f2f'];
export const probLook = n => {
  const p = pips(n);
  return { p, w: p / 5, h: p + 1, c: PROB_COLOR[p] || '' };
};
