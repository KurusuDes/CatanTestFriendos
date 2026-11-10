// What gameView/lobby need from a board: the 3D renderer and the 2D SVG fallback both fit this.
import type { BState, BoardViewState } from './types';

export interface BoardRenderer {
  zoom: number;
  render(st: BState, view?: BoardViewState): void;
  setZoom(z: number): void;
  resetView(): void;
  dispose(): void;
  /** 3D only: straight-down plan view. */
  top?: boolean;
  setTopView?(on: boolean): void;
  /** 3D only: resolves once the first build and the shader compile are done. */
  ready?: Promise<void>;
}
