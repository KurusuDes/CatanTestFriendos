// Minimal structural types for what the board reads from the game state. The engine gets its own
// full types later; these only describe the fields used here.
export interface BTile {
  id: number;
  q: number;
  r: number;
  x: number;
  y: number;
  res: string;
  num: number | null;
  revealed: boolean;
  numRevealed?: boolean;
}
export interface BVertex {
  x: number;
  y: number;
  port?: number | null;
}
export interface BEdge {
  a: number;
  b: number;
}
export interface BPort {
  id: number;
  edge: number;
  x: number;
  y: number;
  nx: number;
  ny: number;
  type: string;
}
export interface BBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}
export interface BBoard {
  tiles: BTile[];
  sea: { x: number; y: number }[];
  vertices: BVertex[];
  edges: BEdge[];
  ports: BPort[];
  bounds: BBounds;
  robber: number;
  robberHidden?: boolean;
}
export interface BPlayer {
  color: string;
  name?: string;
  flag?: string;
  adhdWins?: number;
}
export interface BBuilding {
  owner: number;
  type: string;
}
export interface BState {
  board: BBoard;
  buildings: Record<number, BBuilding>;
  roads: Record<number, number>;
  players: BPlayer[];
  config: { rules: { noRobber?: boolean } };
}

export type VisionCircle = [number, number, number];
export type VisionCap = [number, number, number, number, number];
export interface Vision {
  circles: VisionCircle[];
  caps: VisionCap[];
}
export interface Interaction {
  kind: string;
  color?: string;
  legal: Iterable<number>;
  onPick: (id: number) => void;
}
export interface BlindPiece {
  pid: number;
  vid: number;
  eid?: number | null;
  type: string;
}
/** What the local viewer may see and click (second argument of render). */
export interface BoardViewState {
  faceDown?: boolean;
  flipAt?: number;
  rolled?: number | null;
  rolledAt?: number;
  vision?: Vision | null;
  blindOwn?: BlindPiece[];
  interaction?: Interaction | null;
  pulseTiles?: Set<number>;
  viewer?: number;
  showAll?: boolean;
}
