// What the board reads from the game state: narrow views derived from the engine types, so the
// two can never drift apart (a full engine GameState is assignable to BState without casts).
import type { Edge, Port, Player, Tile, Vertex } from '@engine/types';

export type BTile = Pick<Tile, 'id' | 'q' | 'r' | 'x' | 'y' | 'res' | 'num' | 'revealed'> & Partial<Pick<Tile, 'numRevealed'>>;
export type BVertex = Pick<Vertex, 'x' | 'y'> & Partial<Pick<Vertex, 'port'>>;
export type BEdge = Pick<Edge, 'a' | 'b'>;
export type BPort = Pick<Port, 'id' | 'edge' | 'type'> & { x: number; y: number; nx: number; ny: number };
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
export type BPlayer = Pick<Player, 'color'> & Partial<Pick<Player, 'name' | 'flag'>>;
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
