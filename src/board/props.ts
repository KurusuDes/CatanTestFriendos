// Instanced Blender props (forests, sheep, improvements...) sitting on the terrain.
import * as THREE from 'three';
import { PROP_VARIANTS, VARIANT_TINT } from './assets';
import { shared } from './dispose';
import type { Board3D } from './Board3D';

/** Builds the instanced meshes of the prop lists made by terrainGen (flat [x, y, z, scale, rotY] per instance). */
export function placeProps(board: Board3D, props: Record<string, Float32Array>) {
  const kit = board.kit;
  const inst = props;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const [key, list] of Object.entries(inst)) {
    const [name, variant] = key.split('#');
    const proto = kit[name!];
    if (!proto) continue;
    proto.updateMatrixWorld(true);
    proto.traverse(obj => {
      const child = obj as THREE.Mesh;
      if (!child.isMesh) return;
      let mat = child.material as THREE.MeshStandardMaterial | undefined;
      if (variant) {
        const cache = (PROP_VARIANTS[key] = PROP_VARIANTS[key] || new Map());
        mat = cache.get(child.material as THREE.Material) as THREE.MeshStandardMaterial | undefined;
        if (!mat) {
          const src = child.material as THREE.MeshStandardMaterial;
          mat = src.clone();
          mat.color.multiply(VARIANT_TINT[variant]!);
          // same shader patch (fog, wind...) as the original: clone() leaves those hooks behind
          mat.onBeforeCompile = src.onBeforeCompile;
          mat.customProgramCacheKey = src.customProgramCacheKey;
          cache.set(src, shared(mat));
        }
      }
      const im = new THREE.InstancedMesh(child.geometry, mat, list.length / 5);
      im.castShadow = im.receiveShadow = true;
      for (let i = 0, n = list.length / 5; i < n; i++) {
        const o = i * 5;
        m4.compose(pv.set(list[o]!, list[o + 1]!, list[o + 2]!), q.setFromAxisAngle(up, list[o + 4]!), sv.setScalar(list[o + 3]!)).multiply(child.matrixWorld);
        im.setMatrixAt(i, m4);
      }
      im.instanceMatrix.needsUpdate = true;
      board.staticGroup.add(im);
    });
  }
}
