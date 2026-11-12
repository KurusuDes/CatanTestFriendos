// GPU resource hygiene. Anything cached and reused across rebuilds (kit models, tinted
// materials, shared geometries) is flagged `userData.shared` and is never disposed here.
import * as THREE from 'three';

/** Flags a geometry, material or texture (and the textures of a material) as shared. */
export function shared<T extends { userData: Record<string, any> }>(x: T): T {
  x.userData.shared = true;
  const m = x as unknown as Record<string, any>;
  if (m.isMaterial) for (const k in m) if (m[k] && m[k].isTexture) m[k].userData.shared = true;
  return x;
}

/** Flags every geometry/material/texture of a loaded model as shared. */
export function markShared(root: THREE.Object3D): void {
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    shared(m.geometry);
    for (const mt of ([] as THREE.Material[]).concat(m.material)) shared(mt);
  });
}

function disposeMaterial(mt: THREE.Material): void {
  if (mt.userData.shared) return;
  const m = mt as unknown as Record<string, any>;
  for (const k in m) {
    const v = m[k];
    if (v && v.isTexture && !v.userData.shared) v.dispose();
  }
  mt.dispose();
}

/**
 * Disposes the geometries, materials and textures under `obj` that are not shared, frees the
 * instance buffers of instanced meshes, runs `userData.extra` disposables and removes CSS2D labels.
 */
export function disposeTree(obj: THREE.Object3D): void {
  obj.traverse(o => {
    const el = (o as any).element;
    if ((o as any).isCSS2DObject && el) el.remove();
    const extra = o.userData.extra as { dispose(): void }[] | undefined;
    if (extra) for (const e of extra) e.dispose();
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    const m = o as THREE.Mesh;
    if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
    if (m.material) for (const mt of ([] as THREE.Material[]).concat(m.material)) disposeMaterial(mt);
  });
}

/** Removes every child of `group` and disposes it. */
export function disposeChildren(group: THREE.Object3D): void {
  for (const c of [...group.children]) {
    group.remove(c);
    disposeTree(c);
  }
}
