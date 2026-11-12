// Camera: framing, lens, top-view animation, zoom, token scaling, picking.
import * as THREE from 'three';
import type { Board3D } from './Board3D';

export const FOV = 32;
const TOP_FOV = 11; // the normal lens and the narrow one of the top view
interface View {
  target: THREE.Vector3;
  pos: THREE.Vector3;
  fov: number;
}
const TOKEN_SPAN = 0.75; // widest a number token gets on the map, in world units (a hex is 1.73 across)

// page coordinates -> point on the terrain (null outside the island's area)
export function pickGround(board: Board3D, cx: number, cy: number) {
  const r = board.canvas.getBoundingClientRect();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), board.camera);
  const hit = new THREE.Vector3();
  let y = 0.3;
  // walk the ray onto the heightfield: intersect at a height, resample the terrain there, repeat
  for (let i = 0; i < 4; i++) {
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), hit)) return null;
    y = Math.max(board.heightAt(hit.x, hit.z), 0.02);
  }
  const b = board.bounds;
  if (b && (hit.x < b.minX - 1.5 || hit.x > b.maxX + 1.5 || hit.z < b.minY - 1.5 || hit.z > b.maxY + 1.5)) return null;
  return new THREE.Vector3(hit.x, y, hit.z);
}

export function setZoom(board: Board3D, z: number) {
  const nz = Math.max(0.5, Math.min(4, z));
  const dir = board.camera.position.clone().sub(board.controls.target).multiplyScalar(board.zoom / nz);
  board.zoom = nz;
  board.camera.position.copy(board.controls.target).add(dir);
}

export function resetView(board: Board3D) {
  board.zoom = 1;
  board.camAnim = null;
  board.frame();
}

// where the camera goes to frame the whole map: tilted (the normal view) or straight down
export function framing(board: Board3D, top: boolean): View {
  const b = board.bounds!;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minY + b.maxY) / 2;
  if (!top) {
    const size = Math.max(b.maxX - b.minX, (b.maxY - b.minY) * 1.2);
    const d = size * 0.86 + 1.4;
    return { target: new THREE.Vector3(cx, 0.2, cz + 0.4), pos: new THREE.Vector3(cx, d * 0.8, cz + d * 0.62), fov: FOV };
  }
  // fit the land and the port signs (the bounds also hold a strip of sea)
  const bd = board.lastSt && board.lastSt.board;
  const pts: number[][] = bd ? [...bd.tiles.map(t => [t.x, t.y, 1]), ...bd.ports.map(q => [q.x, q.y, 0.6])] : [[b.minX, b.minY, 0], [b.maxX, b.maxY, 0]];
  const x0 = Math.min(...pts.map(q => q[0]! - q[2]!)), x1 = Math.max(...pts.map(q => q[0]! + q[2]!));
  const z0 = Math.min(...pts.map(q => q[1]! - q[2]!)), z1 = Math.max(...pts.map(q => q[1]! + q[2]!));
  const t = Math.tan((TOP_FOV * Math.PI) / 360);
  const d = Math.max(z1 - z0 + 0.6, (x1 - x0 + 0.6) / board.camera.aspect) / (2 * t);
  const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
  // a hair south of straight above, so north stays up like in the tilted view
  return { target: new THREE.Vector3(mx, 0.2, mz), pos: new THREE.Vector3(mx, 0.2 + d, mz + d * 0.002), fov: TOP_FOV };
}

export function frame(board: Board3D) {
  if (!board.bounds) return;
  const f = board.framing(board.top);
  board.controls.target.copy(f.target);
  board.camera.position.copy(f.pos);
  board.lens(f.fov);
  board.controls.update();
}

// a narrower lens goes with a farther camera: the zoom limits and the haze stretch with it
export function lens(board: Board3D, fov: number) {
  const cam = board.camera, c = board.controls, fog = board.scene.fog as THREE.Fog;
  cam.fov = fov;
  cam.updateProjectionMatrix();
  const k = Math.tan((FOV * Math.PI) / 360) / Math.tan((fov * Math.PI) / 360);
  c.minDistance = 3 * k;
  c.maxDistance = 50 * k;
  fog.near = 34 * k;
  fog.far = 95 * k;
}

// top view: straight down through a narrow lens, so the map reads almost like a flat plan. It
// looks orthographic but keeps the perspective camera that every effect (AO, tilt-shift) expects
export function setTopView(board: Board3D, on: boolean) {
  on = !!on;
  if (on === !!board.top || !board.bounds) return;
  const cam = board.camera, c = board.controls;
  const from = { target: c.target.clone(), pos: cam.position.clone(), fov: cam.fov };
  let to: View;
  if (on) {
    board.beforeTop = { ...from, zoom: board.zoom };
    to = board.framing(true);
    board.zoom = 1;
    c.minPolarAngle = 0;
  } else {
    // back to where you were before going up
    to = board.beforeTop || board.framing(false);
    board.zoom = board.beforeTop ? board.beforeTop.zoom : 1;
  }
  board.top = on;
  c.enableRotate = !on;
  // a plan seen from above has no miniature blur at the edges
  if (board.hts) board.hts.enabled = board.vts!.enabled = !on;
  board.camAnim = { from, to, t0: board.now() };
}

// eases the camera between the two views (position, aim and lens together)
export function updateCamAnim(board: Board3D, now: number) {
  const a = board.camAnim;
  if (!a) return;
  const k = Math.min(1, (now - a.t0) / 700), e = k * k * (3 - 2 * k);
  board.controls.target.lerpVectors(a.from.target, a.to.target, e);
  board.camera.position.lerpVectors(a.from.pos, a.to.pos, e);
  board.lens(a.from.fov + (a.to.fov - a.from.fov) * e);
  if (k < 1) return;
  board.camAnim = null;
  if (!board.top) board.controls.minPolarAngle = 0.3;
}

// the number tokens keep to their tiles: zoomed out they shrink instead of covering the island
export function scaleTokens(board: Board3D) {
  const dist = board.camera.position.distanceTo(board.controls.target);
  const ppu = (board.viewH || 600) / (2 * dist * Math.tan((board.camera.fov * Math.PI) / 360)); // screen px per world unit
  const tk = Math.max(0.35, Math.min(1, Math.round(((ppu * TOKEN_SPAN) / 40) * 20) / 20));
  if (tk === board.tk) return;
  board.tk = tk;
  board.labels.domElement.style.setProperty('--tk', String(tk));
  if (board.tokenSprites) board.tokenSprites.setTk(tk);
  if (board.portSprites) board.portSprites.setTk(tk);
}

// world point -> page coordinates (null when it is behind the camera)
export function toScreen(board: Board3D, x: number, y: number, z: number) {
  const v = new THREE.Vector3(x, y, z).project(board.camera);
  if (v.z > 1) return null;
  // measured once per resize/scroll, not per floater per frame (that forced a layout every frame)
  const r = board.canvasRect || (board.canvasRect = board.canvas.getBoundingClientRect());
  return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
}
