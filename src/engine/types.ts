// Shared types of the rules engine. The whole game is a plain JSON-serializable
// `GameState` mutated only through `applyAction()`.

// ---------- resources ----------
export type Res = 'wood' | 'brick' | 'sheep' | 'wheat' | 'ore';
export type Hand = Record<Res, number>;
/** What a hex produces. */
export type TileKind = Res | 'desert' | 'gold';
export type DevType = 'knight' | 'vp' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly';
export type DevDeckId = 'normal' | 'war' | 'progress' | 'none';
export type BuildKind = 'road' | 'settlement' | 'city';
export type EventId =
  | 'bonanza' | 'drought' | 'fairTrade' | 'blackMarket' | 'earthquake' | 'storm'
  | 'gift' | 'plague' | 'tax' | 'rebellion' | 'calm';

// ---------- board ----------
export interface Tile {
  id: number;
  q: number;
  r: number;
  x: number;
  y: number;
  kind: 'land';
  res: TileKind;
  num: number | null;
  verts: number[];
  revealed: boolean;
  numRevealed: boolean;
}

/** A decorative sea hex around the land (visual only). */
export interface SeaTile {
  q: number;
  r: number;
  x: number;
  y: number;
}

export interface Vertex {
  id: number;
  x: number;
  y: number;
  hexes: number[];
  adj: number[];
  edges: number[];
  port: number | null;
}

export interface Edge {
  id: number;
  a: number;
  b: number;
  hexes: number[];
}

export interface Port {
  id: number;
  edge: number;
  type: Res | 'any';
  ratio: number;
  x: number;
  y: number;
  nx: number;
  ny: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface Board {
  tiles: Tile[];
  sea: SeaTile[];
  vertices: Vertex[];
  edges: Edge[];
  ports: Port[];
  bounds: Bounds;
  /** tile id, -1 when there is no desert to start on */
  robber: number;
  /** where the robber was before its last move (set after the first move) */
  robberFrom?: number;
}

// ---------- config ----------
export type BotLevel = 'easy' | 'normal' | 'hard';
export type SeatKind = 'human' | 'bot';
export type ShapeId =
  | 'classic' | 'mini' | 'extended' | 'big' | 'huge' | 'ring' | 'star' | 'kingdoms'
  | 'islands' | 'pangea' | 'custom';

export interface PlayerConfig {
  name: string;
  kind: SeatKind;
  level?: BotLevel;
  color: string;
  /** kingdom banner: grid string or PNG data URL */
  flag?: string | null;
}

export interface CustomTile {
  q: number;
  r: number;
  res?: TileKind | 'random' | null;
  num?: number | null;
}

export interface CustomMap {
  tiles: CustomTile[];
  name?: string;
}

export interface MapConfig {
  shape: ShapeId;
  size: number;
  resources: 'balanced' | 'chaos';
  numbers: 'balanced' | 'random';
  deserts: 'auto' | number | null;
  gold: number;
  ports: 'none' | 'few' | 'normal' | 'many';
  custom: CustomMap | null;
}

export interface Rules {
  vpTarget: number;
  handLimit: number;
  setupRounds: number;
  setupCity: boolean;
  friendlyRobber: boolean;
  robberGrace: number;
  startBonus: number;
  productionMult: number;
  devDeck: DevDeckId;
  diceMode: 'random' | 'balanced';
  maxRoads: number;
  maxSettlements: number;
  maxCities: number;
  randomStart: boolean;
  noRobber: boolean;
}

export interface Modes {
  flipped: boolean;
  blindfold: boolean;
  fog: boolean;
  hiddenNumbers: boolean;
  events: boolean;
  chaosEvery: number;
  chaosWhat: 'numbers' | 'resources' | 'both';
  privacy: string;
}

export interface Config {
  seed: number;
  players: PlayerConfig[];
  map: MapConfig;
  rules: Rules;
  modes: Modes;
}

export interface Mode {
  id: string;
  icon: string;
  name: string;
  flagship?: boolean;
  desc: string;
  get: (c: Config) => boolean;
  set: (c: Config, v: boolean) => void;
}

export interface Preset {
  id: string;
  icon: string;
  name: string;
  desc: string;
  apply: (c: Config) => void;
}

export interface Rng {
  s: number;
}

// ---------- game state ----------
export type Phase = 'setup' | 'roll' | 'main' | 'discard' | 'robber' | 'roadBuilding' | 'gameOver';

export interface Building {
  owner: number;
  type: 'settlement' | 'city';
}

export interface DevCard {
  type: DevType;
  turn: number;
}

export interface Player {
  id: number;
  name: string;
  color: string;
  kind: SeatKind;
  level: BotLevel;
  flag: string | null;
  retired: boolean;
  res: Hand;
  dev: DevCard[];
  knights: number;
  roadLen: number;
  roadsLeft: number;
  settlementsLeft: number;
  citiesLeft: number;
  stats: { gained: number; stolen: number; lost: number };
  /** turn of the last trade proposal and how many were made that turn */
  tradeTurn?: number;
  tradeCount?: number;
}

/** A secret (blindfold) placement waiting for the reveal. */
export interface BlindPlacement {
  pid: number;
  vid: number;
  eid: number | null;
  round: number;
  type: 'settlement' | 'city';
}

export interface SetupEntry {
  pid: number;
  round: number;
  /** re-placement after a blindfold clash: only the road is missing, next to `vid` */
  roadOnly?: boolean;
  vid?: number;
}

export interface SetupState {
  queue: SetupEntry[];
  idx: number;
  step: 'settlement' | 'road';
  lastVid: number | null;
  blindActive: boolean;
  lastRound: number;
  fixing: boolean;
  /** flipped mode: [pid, vid] setup resources paid on the flip */
  pendingRes?: [number, number][];
}

export interface GameEvent {
  id: EventId;
  name: string;
  icon: string;
  res?: Res;
  tiles?: [number, number];
  tile?: number;
  pid?: number;
}

type TradeResponse = 'accept' | 'reject' | null;

export interface Trade {
  id: number;
  from: number;
  give: Hand;
  get: Hand;
  to: number[];
  responses: Record<string, TradeResponse>;
}

export interface LogEntry {
  turn: number;
  pid: number;
  msg: string;
}

export interface Discovered {
  v: number[];
  e: number[];
}

export interface GameState {
  v: number;
  config: Config;
  rng: Rng;
  board: Board;
  players: Player[];
  buildings: Record<string, Building>;
  roads: Record<string, number>;
  blind: BlindPlacement[];
  bank: Hand;
  bankTotal: number;
  devDeck: DevType[];
  devTotal: number;
  phase: Phase;
  current: number;
  first: number;
  turn: number;
  round: number;
  setup: SetupState;
  dice: [number, number] | null;
  diceDeck: [number, number][];
  pendingDiscards: Record<string, number>;
  robberReturn: Phase;
  freeRoads: number;
  devPlayed: boolean;
  trade: Trade | null;
  tradeSeq: number;
  longestRoad: { owner: number; len: number };
  largestArmy: { owner: number; count: number };
  event: GameEvent | null;
  winner: number | null;
  log: LogEntry[];
  fx: Fx[];
  stats: { rolls: number[] };
  rollLog: { pid: number; sum: number }[];
  actions: number;
  /** fog mode: hidden pieces each player has bumped into */
  discovered?: Record<string, Discovered>;
}

// ---------- fog of war ----------
export interface Vision {
  /** [x, y, radius] */
  circles: [number, number, number][];
  /** [x1, y1, x2, y2, radius] */
  caps: [number, number, number, number, number][];
}

/** What `viewFor` returns: the state itself, or (fog mode) a filtered copy with `vision`. */
export type GameView = GameState & {
  vision?: Vision;
  board: Board & { robberHidden?: boolean };
};

// ---------- actions ----------
export type Action =
  | { type: 'placeSettlement'; pid: number; vid: number }
  | { type: 'placeRoad'; pid: number; eid: number }
  | { type: 'roll'; pid: number; power?: number }
  | { type: 'discard'; pid: number; res: Partial<Hand> }
  | { type: 'moveRobber'; pid: number; tile: number; victim?: number | null }
  | { type: 'build'; pid: number; what: BuildKind; at: number }
  | { type: 'endRoadBuilding'; pid: number }
  | { type: 'buyDev'; pid: number }
  | { type: 'playDev'; pid: number; card: 'knight' | 'roadBuilding' }
  | { type: 'playDev'; pid: number; card: 'yearOfPlenty'; res: Res[] }
  | { type: 'playDev'; pid: number; card: 'monopoly'; res: Res }
  | { type: 'bankTrade'; pid: number; give: Res; get: Res }
  | { type: 'proposeTrade'; pid: number; give: Partial<Hand>; get: Partial<Hand>; to?: number[] }
  | { type: 'respondTrade'; pid: number; accept: boolean; tradeId?: number | null }
  | { type: 'confirmTrade'; pid: number; with: number }
  | { type: 'cancelTrade'; pid: number }
  | { type: 'endTurn'; pid: number }
  | { type: 'setController'; pid: number; kind: SeatKind }
  | { type: 'retirePlayer'; pid: number };

export type ActionType = Action['type'];
export type ActionOf<T extends ActionType> = Extract<Action, { type: T }>;

// ---------- effects (one-shot hints for the UI, rebuilt on every action) ----------
export type Fx =
  | { kind: 'revealTile'; tile: number }
  | { kind: 'award'; what: 'road' | 'army'; pid: number }
  | { kind: 'win'; pid: number }
  | { kind: 'gain'; pid: number; res: Res; n: number; tiles?: number[] }
  | { kind: 'chaos' }
  | { kind: 'event'; event: GameEvent }
  | { kind: 'flipAll' }
  | { kind: 'blindReveal'; placements: { pid: number; vid: number; eid: number | null; ok: boolean }[] }
  | { kind: 'blocked'; pid: number; what: 'vertex' | 'edge'; at: number }
  | { kind: 'relocated'; pid: number; what: 'vertex' | 'edge'; from: number; to: number }
  | { kind: 'build'; what: BuildKind; pid: number; at: number; hidden?: boolean }
  | { kind: 'dice'; dice: [number, number]; power: number }
  | { kind: 'discard'; pid: number; res: Hand }
  | { kind: 'robber'; tile: number }
  | { kind: 'steal'; from: number; to: number; res: Res | null }
  | { kind: 'devBought'; pid: number; type: DevType }
  | { kind: 'devPlayed'; pid: number; card: DevType }
  | { kind: 'fromBank'; pid: number; res: Res[] }
  | { kind: 'monopoly'; pid: number; res: Res; from: [number, number][] }
  | { kind: 'bankTrade'; pid: number; give: Res; n: number; get: Res }
  | { kind: 'trade'; a: number; b: number; give: Hand; get: Hand }
  | { kind: 'controller'; pid: number; to: SeatKind }
  | { kind: 'retired'; pid: number };

export type ApplyResult = { ok: true; blocked?: true } | { ok: false; error: string };
