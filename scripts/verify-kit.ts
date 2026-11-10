// So sánh kit.glb gốc (tools/source) với bản nén meshopt (public/assets/models) trong Node.
// Chạy: pnpm tsx scripts/verify-kit.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Box3, BufferGeometry, Mesh, Object3D, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Node không có DOM: giả lập tối thiểu để TextureLoader không làm hỏng parse (giữ tham chiếu texture).
function stubDom(): void {
  const g = globalThis as Record<string, unknown>;
  if (g.document) return;
  g.self ??= globalThis;
  g.document = {
    createElementNS: () => {
      const listeners: Record<string, Array<() => void>> = {};
      const img: Record<string, unknown> = {
        addEventListener: (t: string, f: () => void) => ((listeners[t] ??= []).push(f)),
        removeEventListener: () => {},
        width: 1,
        height: 1,
      };
      Object.defineProperty(img, 'src', {
        set() {
          queueMicrotask(() => listeners.load?.forEach((f) => f()));
        },
      });
      return img;
    },
  };
}

async function load(path: string): Promise<Object3D> {
  stubDom();
  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(ab, '');
  gltf.scene.updateMatrixWorld(true);
  return gltf.scene;
}

function meshesOf(node: Object3D): Mesh[] {
  const out: Mesh[] = [];
  node.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
}

function worldBox(node: Object3D): Box3 {
  return new Box3().setFromObject(node, true);
}

export interface VerifyResult {
  errors: string[];
  nodes: number;
  meshes: number;
  vertices: number;
  maxPosDelta: number;
  maxBoxDelta: number;
  notes: string[];
}

export async function verifyKit(srcPath: string, outPath: string): Promise<VerifyResult> {
  const [a, b] = [await load(srcPath), await load(outPath)];
  const errors: string[] = [];
  const err = (m: string) => errors.push(m);
  const res: VerifyResult = { errors, nodes: 0, meshes: 0, vertices: 0, maxPosDelta: 0, maxBoxDelta: 0, notes: [] };

  const namesA = a.children.map((c) => c.name);
  const namesB = b.children.map((c) => c.name);
  if (namesA.join() !== namesB.join()) err(`tên node cấp 1 khác: [${namesA}] vs [${namesB}]`);
  res.nodes = namesA.length;

  const v = new Vector3();
  const w = new Vector3();
  for (const na of a.children) {
    const nb = b.getObjectByName(na.name);
    if (!nb) {
      err(`thiếu node ${na.name}`);
      continue;
    }
    if (!na.matrix.equals(nb.matrix)) {
      const d = na.matrix.elements.reduce((m, x, i) => Math.max(m, Math.abs(x - nb.matrix.elements[i]!)), 0);
      if (d > 1e-6) err(`${na.name}: ma trận local khác (${d})`);
    }
    const ma = meshesOf(na);
    const mb = meshesOf(nb);
    if (ma.length !== mb.length) {
      err(`${na.name}: số mesh ${ma.length} vs ${mb.length}`);
      continue;
    }
    // ghép theo thứ tự; so tên vật liệu để chắc chắn khớp
    for (let i = 0; i < ma.length; i++) {
      const x = ma[i]!;
      const y = mb[i]!;
      res.meshes++;
      const tag = `${na.name}#${i}`;
      const mx = (Array.isArray(x.material) ? x.material : [x.material]) as any[];
      const my = (Array.isArray(y.material) ? y.material : [y.material]) as any[];
      if (mx.map((m) => m.name).join() !== my.map((m) => m.name).join()) err(`${tag}: tên vật liệu khác`);
      mx.forEach((m, k) => {
        const n = my[k];
        if (!n) return;
        if (!!m.map !== !!n.map) err(`${tag}/${m.name}: map ${!!m.map} vs ${!!n.map}`);
        if (m.vertexColors !== n.vertexColors) err(`${tag}/${m.name}: vertexColors khác`);
        if (Math.abs(m.color.r - n.color.r) + Math.abs(m.color.g - n.color.g) + Math.abs(m.color.b - n.color.b) > 1e-6) err(`${tag}/${m.name}: color khác`);
      });
      const ga: BufferGeometry = x.geometry;
      const gb: BufferGeometry = y.geometry;
      const attA = Object.keys(ga.attributes).sort().join();
      const attB = Object.keys(gb.attributes).sort().join();
      if (attA !== attB) err(`${tag}: attribute [${attA}] vs [${attB}]`);
      const pa = ga.getAttribute('position');
      const pb = gb.getAttribute('position');
      // gltfpack có thể gộp đỉnh trùng khít hoàn toàn (bit-identical): chỉ cho phép giảm, so khớp theo tập đỉnh duy nhất
      if (pb.count > pa.count) err(`${tag}: số đỉnh tăng ${pa.count} -> ${pb.count}`);
      if (pa.count !== pb.count) res.notes.push(`${tag}: số đỉnh ${pa.count} -> ${pb.count} (gộp đỉnh trùng)`);
      res.vertices += pa.count;
      const ia = ga.index?.count ?? 0;
      const ib = gb.index?.count ?? 0;
      // gltfpack bỏ tam giác suy biến (diện tích 0): so số tam giác có diện tích > 0
      const na0 = realTris(ga);
      const nb0 = realTris(gb);
      if (na0 !== nb0) err(`${tag}: tam giác thật ${na0} vs ${nb0}`);
      if (ia !== ib) res.notes.push(`${tag}: index ${ia} -> ${ib} (bỏ ${(ia - ib) / 3} tam giác suy biến)`);
      // meshopt có thể sắp xếp lại đỉnh: so khớp theo tập hợp đỉnh (sắp xếp) chứ không theo thứ tự
      const key = (g: BufferGeometry, m: Mesh): number[] => {
        const p = g.getAttribute('position');
        const out: number[] = [];
        for (let k = 0; k < p.count; k++) {
          v.fromBufferAttribute(p, k).applyMatrix4(m.matrixWorld);
          out.push(v.x, v.y, v.z);
        }
        return out;
      };
      const ka = uniqTriples(sortTriples(key(ga, x)));
      const kb = uniqTriples(sortTriples(key(gb, y)));
      if (ka.length !== kb.length) {
        err(`${tag}: số đỉnh duy nhất ${ka.length / 3} vs ${kb.length / 3}`);
        continue;
      }
      let md = 0;
      for (let k = 0; k < ka.length; k++) md = Math.max(md, Math.abs(ka[k]! - kb[k]!));
      res.maxPosDelta = Math.max(res.maxPosDelta, md);
      if (md > 1e-5) err(`${tag}: lệch vị trí đỉnh ${md}`);
      void w;
    }
    const ba = worldBox(na);
    const bb = worldBox(nb);
    const d = Math.max(
      ...(['min', 'max'] as const).flatMap((k) =>
        (['x', 'y', 'z'] as const).map((c) => Math.abs(ba[k][c] - bb[k][c])),
      ),
    );
    res.maxBoxDelta = Math.max(res.maxBoxDelta, d);
    if (d > 1e-4) err(`${na.name}: bbox lệch ${d}`);
  }
  return res;
}

function realTris(g: BufferGeometry): number {
  const p = g.getAttribute('position');
  const idx = g.index;
  const n = idx ? idx.count : p.count;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  let k = 0;
  for (let i = 0; i < n; i += 3) {
    const [i0, i1, i2] = idx ? [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)] : [i, i + 1, i + 2];
    a.fromBufferAttribute(p, i0);
    b.fromBufferAttribute(p, i1).sub(a);
    c.fromBufferAttribute(p, i2).sub(a);
    if (b.cross(c).lengthSq() > 1e-18) k++;
  }
  return k;
}

function uniqTriples(a: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.length; i += 3) {
    const n = out.length;
    if (n && Math.abs(out[n - 3]! - a[i]!) < 1e-6 && Math.abs(out[n - 2]! - a[i + 1]!) < 1e-6 && Math.abs(out[n - 1]! - a[i + 2]!) < 1e-6) continue;
    out.push(a[i]!, a[i + 1]!, a[i + 2]!);
  }
  return out;
}

function sortTriples(a: number[]): number[] {
  const t: number[][] = [];
  for (let i = 0; i < a.length; i += 3) t.push([a[i]!, a[i + 1]!, a[i + 2]!]);
  // làm tròn khi so thứ tự để nhiễu ~1e-7 không đổi thứ tự
  const r = (x: number) => Math.round(x * 1e4);
  t.sort((p, q) => r(p[0]!) - r(q[0]!) || r(p[1]!) - r(q[1]!) || r(p[2]!) - r(q[2]!));
  return t.flat();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await verifyKit('tools/source/kit.glb', 'public/assets/models/kit.glb');
  console.log(
    `node: ${r.nodes}, mesh: ${r.meshes}, đỉnh: ${r.vertices}, lệch đỉnh max: ${r.maxPosDelta.toExponential(2)}, lệch bbox max: ${r.maxBoxDelta.toExponential(2)}`,
  );
  if (r.notes.length) console.log(r.notes.join('\n'));
  if (r.errors.length) {
    console.error('LỖI:\n' + r.errors.join('\n'));
    process.exit(1);
  }
  console.log('kit.glb tương đương bản gốc');
}
