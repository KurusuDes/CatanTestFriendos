// Public API of the rules engine. UI code imports per module (`@engine/game`, `@engine/board`, ...)
// to keep chunks clean; this barrel is for tools, tests and anything that wants the whole surface.
export {
  zeroRes, handSize, canAfford, createGame, B, VISION, visionOf, visibility, viewFor, victoryPoints, tradeRatio,
  canSetupSettlement, canSetupRoad, canBuildRoad, canBuildSettlement, canBuildCity,
  legalSetupSettlements, legalSetupRoads, legalRoads, legalSettlements, legalCities,
  robberVictims, stealTargets, legalRobberTiles, playableDev, pendingActors, nextActive, applyAction,
} from './game';
export { botAct, hint } from './bot';
export {
  DIRS, hk, hexCenter, hexDist, hexagon, rows, blob, pixelToHex, islands, SHAPES, genTokens, generateBoard,
} from './board';
export type { Hex } from './board';
export { PLAYER_COLORS, BOT_NAMES, defaultConfig, MODES, PRESETS } from './config';
export { RES, isRes, resEntries, TILE_INFO, COSTS, DEV_INFO, DEV_DECKS, EVENTS, pips, probLook } from './constants';
export { rand, randInt, shuffle, pick, newSeed } from './rng';
export type {
  Res, Hand, TileKind, DevType, DevDeckId, BuildKind, EventId, Tile, SeaTile, Vertex, Edge, Port, Bounds, Board,
  BotLevel, SeatKind, ShapeId, PlayerConfig, CustomTile, CustomMap, MapConfig, Rules, Modes, Config, Mode, Preset,
  Rng, Phase, Building, DevCard, Player, BlindPlacement, SetupEntry, SetupState, GameEvent, TradeResponse, Trade,
  LogEntry, Discovered, GameState, Vision, GameView, Action, ActionType, ActionOf, Fx, ApplyResult,
} from './types';
