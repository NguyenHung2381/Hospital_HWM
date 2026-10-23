/**
 * Tự sinh đồ thị đi lại (NavGraph) cho một tầng từ tường, cửa, phòng và thang.
 *
 * 1. Rời rạc hoá mặt bằng thành lưới ô vuông. Ô "đi được" là ô cách tường đủ xa, nằm trong
 *    toà nhà (không nối ra ngoài khi coi mọi cửa là đóng) và không thuộc phòng/thang nào
 *    → đó là hành lang, sảnh chung.
 * 2. Làm mảnh vùng hành lang (Zhang–Suen) để lấy đường tâm, lần theo thành các đoạn,
 *    đơn giản hoá (Douglas–Peucker) và bỏ các nhánh cụt ngắn.
 * 3. Mỗi cửa thành một nút; nối với phòng/thang ở một phía và với đường tâm hành lang ở phía kia
 *    (chiếu vuông góc lên đoạn hành lang gần nhất, tách đoạn tại đó).
 * 4. Dọn dẹp: bỏ phần hành lang không dẫn tới cửa/thang nào, gộp các đỉnh thẳng hàng.
 */
import {
  boundsOf,
  distance,
  furniturePolygon,
  pointInPolygon,
  pointOnWall,
  polygonCentroid,
  projectPointOnSegment,
  signedAngleBetween,
  simplifyPolyline,
  sub,
  toDegrees,
  wallLength,
} from './geometry';
import { createId } from './id';
import { roomDestination } from './lookup';
import type { Connector, Floor, Id, NavEdge, NavGraph, NavNode, Point, Room } from './types';

export interface NavGenOptions {
  /** Kích thước ô lưới (m). Nhỏ hơn = chính xác hơn nhưng chậm hơn. */
  cellSize?: number;
  /** Khoảng cách tối thiểu từ mặt tường tới đường đi (m). */
  clearance?: number;
  /** Khoảng cách từ mặt tường tới điểm kiểm tra hai phía cửa (m). */
  doorReach?: number;
  /** Sai số khi đơn giản hoá đường tâm (m). */
  simplifyTolerance?: number;
  /** Nhánh cụt ngắn hơn giá trị này bị bỏ trước khi gắn cửa (m). */
  minSpurLength?: number;
  /** Khoảng cách tối đa để nối một cửa/thang vào hành lang (m). */
  maxAttachDistance?: number;
}

export interface NavGenWarning {
  message: string;
  refId?: Id;
}

export interface NavGenResult {
  graph: NavGraph;
  warnings: NavGenWarning[];
}

/* ------------------------------------------------------------------ */
/* Lưới                                                                */
/* ------------------------------------------------------------------ */

interface Grid {
  W: number;
  H: number;
  cs: number;
  minX: number;
  minY: number;
}

const cellCenter = (g: Grid, k: number): Point => ({
  x: g.minX + ((k % g.W) + 0.5) * g.cs,
  y: g.minY + (Math.floor(k / g.W) + 0.5) * g.cs,
});

function cellRange(g: Grid, minX: number, minY: number, maxX: number, maxY: number) {
  return {
    i0: Math.max(0, Math.floor((minX - g.minX) / g.cs)),
    j0: Math.max(0, Math.floor((minY - g.minY) / g.cs)),
    i1: Math.min(g.W - 1, Math.floor((maxX - g.minX) / g.cs)),
    j1: Math.min(g.H - 1, Math.floor((maxY - g.minY) / g.cs)),
  };
}

/** Làm mảnh ảnh nhị phân (Zhang–Suen). */
function thin(mask: Uint8Array, W: number, H: number): Uint8Array {
  const img = mask.slice();
  const P = (i: number, j: number) => (i < 0 || j < 0 || i >= W || j >= H ? 0 : img[j * W + i]!);
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of [0, 1]) {
      const remove: number[] = [];
      for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) {
          if (!img[j * W + i]) continue;
          const p = [
            P(i, j - 1),
            P(i + 1, j - 1),
            P(i + 1, j),
            P(i + 1, j + 1),
            P(i, j + 1),
            P(i - 1, j + 1),
            P(i - 1, j),
            P(i - 1, j - 1),
          ];
          const [p2, , p4, , p6, , p8] = p as [
            number,
            number,
            number,
            number,
            number,
            number,
            number,
            number,
          ];
          const b = p.reduce((s, v) => s + v, 0);
          if (b < 2 || b > 6) continue;
          let a = 0;
          for (let t = 0; t < 8; t++) if (!p[t] && p[(t + 1) % 8]) a++;
          if (a !== 1) continue;
          if (step === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue;
          remove.push(j * W + i);
        }
      }
      for (const k of remove) img[k] = 0;
      if (remove.length) changed = true;
    }
  }
  return img;
}

/* ------------------------------------------------------------------ */
/* Đồ thị có thể sửa                                                   */
/* ------------------------------------------------------------------ */

class MutableGraph {
  nodes = new Map<Id, NavNode>();
  edges = new Map<Id, NavEdge>();

  addNode(kind: NavNode['kind'], position: Point, refId?: Id): NavNode {
    const node: NavNode = { id: createId('nav'), kind, position: { ...position }, refId };
    this.nodes.set(node.id, node);
    return node;
  }

  addEdge(from: Id, to: Id) {
    if (from === to) return;
    for (const e of this.edges.values()) {
      if ((e.from === from && e.to === to) || (e.from === to && e.to === from)) return;
    }
    const edge: NavEdge = { id: createId('edge'), from, to };
    this.edges.set(edge.id, edge);
  }

  removeNode(id: Id) {
    this.nodes.delete(id);
    for (const [eid, e] of this.edges) if (e.from === id || e.to === id) this.edges.delete(eid);
  }

  neighbors(id: Id): Id[] {
    const out: Id[] = [];
    for (const e of this.edges.values()) {
      if (e.from === id) out.push(e.to);
      else if (e.to === id) out.push(e.from);
    }
    return out;
  }

  pos(id: Id) {
    return this.nodes.get(id)!.position;
  }

  /**
   * Nối điểm `q` vào hành lang: chiếu lên đoạn hành lang gần nhất, tách đoạn tại hình chiếu
   * (hoặc dùng luôn đầu đoạn nếu hình chiếu rất gần đầu đoạn).
   */
  attachToCorridor(q: Point, maxDist: number): Id | null {
    let best: { edge: NavEdge; t: number; point: Point; d: number; len: number } | null = null;
    for (const e of this.edges.values()) {
      const a = this.nodes.get(e.from)!;
      const b = this.nodes.get(e.to)!;
      if (a.kind !== 'corridor' || b.kind !== 'corridor') continue;
      const proj = projectPointOnSegment(q, a.position, b.position);
      if (!best || proj.distance < best.d) {
        best = {
          edge: e,
          t: proj.t,
          point: proj.point,
          d: proj.distance,
          len: distance(a.position, b.position),
        };
      }
    }
    if (!best) {
      // Không có đoạn hành lang: dùng nút hành lang đơn lẻ gần nhất (nếu có).
      let nearest: NavNode | null = null;
      for (const n of this.nodes.values()) {
        if (n.kind !== 'corridor') continue;
        if (!nearest || distance(n.position, q) < distance(nearest.position, q)) nearest = n;
      }
      return nearest && distance(nearest.position, q) <= maxDist ? nearest.id : null;
    }
    if (best.d > maxDist) return null;
    const SNAP = 0.4;
    if (best.t * best.len < SNAP) return best.edge.from;
    if ((1 - best.t) * best.len < SNAP) return best.edge.to;
    const mid = this.addNode('corridor', best.point);
    this.edges.delete(best.edge.id);
    this.addEdge(best.edge.from, mid.id);
    this.addEdge(mid.id, best.edge.to);
    return mid.id;
  }

  /** Bỏ nút hành lang bậc ≤ 1 (đường cụt không dẫn tới cửa/thang nào), lặp tới khi hết. */
  pruneCorridorLeaves() {
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of [...this.nodes.values()]) {
        if (n.kind === 'corridor' && this.neighbors(n.id).length <= 1) {
          this.removeNode(n.id);
          changed = true;
        }
      }
    }
  }

  /**
   * Bỏ các nhánh cụt ngắn mọc ra từ ngã ba (nhiễu của thuật toán làm mảnh, vd. hai nhánh chéo
   * ở cuối hành lang). Bậc được tính một lần cho mỗi lượt để cắt được cả hai nhánh cùng ngã ba.
   */
  pruneShortSpurs(maxLength: number) {
    let changed = true;
    while (changed) {
      const degree = new Map([...this.nodes.keys()].map((id) => [id, this.neighbors(id).length]));
      const remove = [...this.nodes.values()].filter((n) => {
        if (n.kind !== 'corridor' || degree.get(n.id) !== 1) return false;
        const other = this.neighbors(n.id)[0]!;
        return degree.get(other)! >= 3 && distance(n.position, this.pos(other)) < maxLength;
      });
      for (const n of remove) this.removeNode(n.id);
      changed = remove.length > 0;
    }
  }

  /** Gộp các nút hành lang bậc 2 gần như thẳng hàng hoặc quá sát nhau. */
  mergeStraightCorridorNodes(maxAngleDeg = 8) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of [...this.nodes.values()]) {
        if (n.kind !== 'corridor') continue;
        const nb = this.neighbors(n.id);
        if (nb.length !== 2) continue;
        const [a, b] = nb as [Id, Id];
        const pa = this.pos(a);
        const pb = this.pos(b);
        const angle = Math.abs(
          toDegrees(signedAngleBetween(sub(n.position, pa), sub(pb, n.position))),
        );
        const tooClose = distance(n.position, pa) < 0.3 || distance(n.position, pb) < 0.3;
        if (angle > maxAngleDeg && !tooClose) continue;
        this.removeNode(n.id);
        this.addEdge(a, b);
        changed = true;
      }
    }
  }

  /** Bỏ các thành phần liên thông chỉ gồm nút hành lang (không có cửa/phòng/thang). */
  dropCorridorOnlyComponents() {
    const seen = new Set<Id>();
    for (const start of [...this.nodes.keys()]) {
      if (seen.has(start)) continue;
      const comp: Id[] = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const id = stack.pop()!;
        comp.push(id);
        for (const nb of this.neighbors(id)) {
          if (!seen.has(nb)) {
            seen.add(nb);
            stack.push(nb);
          }
        }
      }
      if (comp.every((id) => this.nodes.get(id)!.kind === 'corridor')) {
        for (const id of comp) this.removeNode(id);
      }
    }
  }

  toNavGraph(): NavGraph {
    return { nodes: [...this.nodes.values()], edges: [...this.edges.values()] };
  }
}

/* ------------------------------------------------------------------ */
/* Đường tâm hành lang                                                  */
/* ------------------------------------------------------------------ */

function buildCorridorSkeleton(
  graph: MutableGraph,
  g: Grid,
  region: Uint8Array,
  opts: Required<NavGenOptions>,
) {
  const S = thin(region, g.W, g.H);
  const on = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < g.W && j < g.H && S[j * g.W + i] === 1;

  // Láng giềng 8 hướng, bỏ hướng chéo khi đã đi được qua ô ngang/dọc (tránh ngã ba giả).
  const nb = (k: number): number[] => {
    const i = k % g.W;
    const j = Math.floor(k / g.W);
    const out: number[] = [];
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      if (on(i + di, j + dj)) out.push((j + dj) * g.W + i + di);
    }
    for (const [di, dj] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      if (on(i + di, j + dj) && !on(i + di, j) && !on(i, j + dj)) out.push((j + dj) * g.W + i + di);
    }
    return out;
  };

  const pixels: number[] = [];
  for (let k = 0; k < S.length; k++) if (S[k]) pixels.push(k);
  const degree = new Map(pixels.map((k) => [k, nb(k).length]));

  // Gom các điểm ngã ba sát nhau thành một nút; điểm đầu mút là một nút riêng.
  const nodeOf = new Map<number, Id>();
  for (const k of pixels) {
    const d = degree.get(k)!;
    if (d === 2 || nodeOf.has(k)) continue;
    if (d === 0) continue; // điểm cô lập
    const cluster = [k];
    if (d >= 3) {
      for (let c = 0; c < cluster.length; c++) {
        for (const n of nb(cluster[c]!)) {
          if (degree.get(n)! >= 3 && !cluster.includes(n)) cluster.push(n);
        }
      }
    }
    const pts = cluster.map((c) => cellCenter(g, c));
    const node = graph.addNode('corridor', {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    });
    for (const c of cluster) nodeOf.set(c, node.id);
  }

  const visitedPixel = new Set<number>();
  const visitedStep = new Set<string>();
  const isKey = (k: number) => nodeOf.has(k);

  const trace = (start: number, first: number) => {
    if (visitedStep.has(`${start}>${first}`)) return;
    visitedStep.add(`${start}>${first}`);
    const path: Point[] = [cellCenter(g, start)];
    let prev = start;
    let cur = first;
    while (!isKey(cur)) {
      visitedPixel.add(cur);
      path.push(cellCenter(g, cur));
      const next = nb(cur).find((x) => x !== prev);
      if (next === undefined) return; // đứt đoạn bất thường
      prev = cur;
      cur = next;
    }
    visitedStep.add(`${cur}>${prev}`);
    path.push(cellCenter(g, cur));
    const a = nodeOf.get(start)!;
    const b = nodeOf.get(cur)!;
    if (a === b && path.length < 4) return;
    // Đỉnh trung gian sau khi đơn giản hoá → nút hành lang (chỗ rẽ).
    const simple = simplifyPolyline(path, opts.simplifyTolerance);
    let last = a;
    for (const p of simple.slice(1, -1)) {
      const n = graph.addNode('corridor', p);
      graph.addEdge(last, n.id);
      last = n.id;
    }
    graph.addEdge(last, b);
  };

  for (const k of pixels) {
    if (!isKey(k)) continue;
    for (const n of nb(k)) {
      if (nodeOf.get(n) === nodeOf.get(k)) continue;
      trace(k, n);
    }
  }
  // Vòng kín không có ngã ba nào: chọn một điểm làm nút rồi lần theo.
  for (const k of pixels) {
    if (degree.get(k) !== 2 || visitedPixel.has(k) || isKey(k)) continue;
    nodeOf.set(k, graph.addNode('corridor', cellCenter(g, k)).id);
    const [first] = nb(k);
    if (first !== undefined) trace(k, first);
  }

  graph.pruneShortSpurs(opts.minSpurLength);
  graph.mergeStraightCorridorNodes();
}

/* ------------------------------------------------------------------ */

const DEFAULTS: Required<NavGenOptions> = {
  cellSize: 0.25,
  clearance: 0.3,
  doorReach: 0.5,
  simplifyTolerance: 0.3,
  minSpurLength: 2.5,
  maxAttachDistance: 8,
};

export function generateNavGraph(floor: Floor, options: NavGenOptions = {}): NavGenResult {
  const opts = { ...DEFAULTS, ...options };
  const warnings: NavGenWarning[] = [];
  const graph = new MutableGraph();

  const bounds = boundsOf(floor.walls.flatMap((w) => [w.start, w.end]));
  if (!bounds) {
    return { graph: { nodes: [], edges: [] }, warnings: [{ message: 'Tầng chưa có tường nào' }] };
  }
  const margin = 1;
  const cs = opts.cellSize;
  const g: Grid = {
    cs,
    minX: bounds.minX - margin,
    minY: bounds.minY - margin,
    W: Math.ceil((bounds.maxX - bounds.minX + 2 * margin) / cs),
    H: Math.ceil((bounds.maxY - bounds.minY + 2 * margin) / cs),
  };
  const N = g.W * g.H;

  // 1. Ô bị tường chặn (coi mọi cửa là đóng để tách trong/ngoài và tách phòng với hành lang).
  const blocked = new Uint8Array(N);
  for (const w of floor.walls) {
    const r = w.thickness / 2 + opts.clearance;
    const { i0, j0, i1, j1 } = cellRange(
      g,
      Math.min(w.start.x, w.end.x) - r,
      Math.min(w.start.y, w.end.y) - r,
      Math.max(w.start.x, w.end.x) + r,
      Math.max(w.start.y, w.end.y) + r,
    );
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * g.W + i;
        if (!blocked[k] && projectPointOnSegment(cellCenter(g, k), w.start, w.end).distance < r) {
          blocked[k] = 1;
        }
      }
    }
  }

  // Nội thất (giường, ghế chờ, quầy…) cũng chặn đường đi như tường, kèm khoảng hở để lách qua.
  const furnished = new Uint8Array(N);
  for (const f of floor.furniture ?? []) {
    const poly = furniturePolygon(f, -opts.clearance);
    const b = boundsOf(poly)!;
    const { i0, j0, i1, j1 } = cellRange(g, b.minX, b.minY, b.maxX, b.maxY);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * g.W + i;
        if (pointInPolygon(cellCenter(g, k), poly)) {
          blocked[k] = 1;
          furnished[k] = 1;
        }
      }
    }
  }

  // 2. Ngoài toà nhà: loang từ viền lưới.
  const outside = new Uint8Array(N);
  const queue: number[] = [];
  for (let i = 0; i < g.W; i++) queue.push(i, (g.H - 1) * g.W + i);
  for (let j = 0; j < g.H; j++) queue.push(j * g.W, j * g.W + g.W - 1);
  for (const k of queue) if (!blocked[k]) outside[k] = 1;
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q]!;
    if (!outside[k]) continue;
    const i = k % g.W;
    const j = Math.floor(k / g.W);
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= g.W || nj >= g.H) continue;
      const nk = nj * g.W + ni;
      if (!blocked[nk] && !outside[nk]) {
        outside[nk] = 1;
        queue.push(nk);
      }
    }
  }

  // 3. Ô thuộc phòng / thang.
  const occupied = new Uint8Array(N);
  for (const shape of [...floor.rooms, ...floor.connectors]) {
    const b = boundsOf(shape.polygon);
    if (!b) continue;
    const { i0, j0, i1, j1 } = cellRange(g, b.minX, b.minY, b.maxX, b.maxY);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * g.W + i;
        if (pointInPolygon(cellCenter(g, k), shape.polygon)) occupied[k] = 1;
      }
    }
  }

  // 4. Vùng hành lang / không gian chung → đường tâm.
  const region = new Uint8Array(N);
  let regionCells = 0;
  for (let k = 0; k < N; k++) {
    if (!blocked[k] && !outside[k] && !occupied[k]) {
      region[k] = 1;
      regionCells++;
    }
  }
  if (regionCells > 0) buildCorridorSkeleton(graph, g, region, opts);

  // 5. Nút phòng / thang (tạo khi cần).
  const roomNodes = new Map<Id, Id>();
  const roomNode = (room: Room) => {
    let id = roomNodes.get(room.id);
    if (!id) {
      // Ưu tiên điểm đích đến do admin đặt; không có thì lấy điểm gần tâm phòng (tránh nội thất).
      const c = polygonCentroid(room.polygon);
      const free = pointInPolygon(c, room.polygon) && !furnished[cellIndex(g, c)];
      const p =
        roomDestination(room) ??
        (free ? c : (interiorPoint(room.polygon, g, occupied, blocked) ?? c));
      id = graph.addNode('room', p, room.id).id;
      roomNodes.set(room.id, id);
    }
    return id;
  };
  const connectorNodes = new Map<Id, Id>();
  const connectorNode = (c: Connector) => {
    let id = connectorNodes.get(c.id);
    if (!id) {
      id = graph.addNode('connector', polygonCentroid(c.polygon), c.id).id;
      connectorNodes.set(c.id, id);
    }
    return id;
  };

  const isOutside = (p: Point) => {
    const i = Math.floor((p.x - g.minX) / cs);
    const j = Math.floor((p.y - g.minY) / cs);
    return i < 0 || j < 0 || i >= g.W || j >= g.H || outside[j * g.W + i] === 1;
  };

  // 6. Cửa: nối hai phía.
  const walls = new Map(floor.walls.map((w) => [w.id, w]));
  for (const o of floor.openings) {
    if (o.type === 'window') continue;
    const w = walls.get(o.wallId);
    if (!w || wallLength(w) === 0) continue;
    const p = pointOnWall(w, o.offset);
    const d = sub(w.end, w.start);
    const len = Math.hypot(d.x, d.y);
    const n = { x: -d.y / len, y: d.x / len };
    const reach = w.thickness / 2 + opts.doorReach;

    const targets: Id[] = [];
    for (const sign of [1, -1]) {
      const s = { x: p.x + n.x * reach * sign, y: p.y + n.y * reach * sign };
      const room = floor.rooms.find((r) => pointInPolygon(s, r.polygon));
      const connector = floor.connectors.find((c) => pointInPolygon(s, c.polygon));
      if (room) targets.push(roomNode(room));
      else if (connector) targets.push(connectorNode(connector));
      else if (!isOutside(s)) {
        const attached = graph.attachToCorridor(s, opts.maxAttachDistance);
        if (attached) targets.push(attached);
      }
    }
    if (targets.length === 0 || (targets.length === 1 && o.type === 'door')) {
      warnings.push({
        message:
          targets.length === 0
            ? 'Cửa không nối được với phòng hay hành lang nào'
            : 'Cửa chỉ nối được một phía (phía kia không thuộc phòng/hành lang nào)',
        refId: o.id,
      });
      if (targets.length === 0) continue;
    }
    const doorNode = graph.addNode(o.type === 'entrance' ? 'entrance' : 'door', p, o.id);
    for (const t of targets) graph.addEdge(doorNode.id, t);
  }

  // 7. Thang không có cửa riêng (thang mở ra hành lang): nối thẳng vào hành lang.
  for (const c of floor.connectors) {
    if (connectorNodes.has(c.id)) continue;
    const id = connectorNode(c);
    const attached = graph.attachToCorridor(graph.pos(id), opts.maxAttachDistance);
    if (attached) graph.addEdge(id, attached);
    else warnings.push({ message: `"${c.name}" không nối được vào hành lang`, refId: c.id });
  }

  for (const room of floor.rooms) {
    if (!roomNodes.has(room.id)) {
      warnings.push({
        message: `Phòng "${room.name}" chưa có cửa — không thể chỉ đường tới`,
        refId: room.id,
      });
    }
  }
  if (regionCells === 0 && floor.rooms.length > 0) {
    warnings.push({ message: 'Không tìm thấy hành lang (vùng chung) nào trên tầng' });
  }

  // 8. Dọn dẹp.
  graph.dropCorridorOnlyComponents();
  graph.pruneCorridorLeaves();
  graph.mergeStraightCorridorNodes();

  return { graph: graph.toNavGraph(), warnings };
}

/** Ô lưới chứa điểm `p` (-1 nếu ngoài lưới). */
function cellIndex(g: Grid, p: Point): number {
  const i = Math.floor((p.x - g.minX) / g.cs);
  const j = Math.floor((p.y - g.minY) / g.cs);
  return i < 0 || j < 0 || i >= g.W || j >= g.H ? -1 : j * g.W + i;
}

/** Một điểm chắc chắn nằm trong đa giác (ô lưới trống gần trọng tâm nhất, không bị `blocked`). */
function interiorPoint(
  polygon: Point[],
  g: Grid,
  occupied: Uint8Array,
  blocked: Uint8Array,
): Point | null {
  const c = polygonCentroid(polygon);
  const b = boundsOf(polygon);
  if (!b) return null;
  const { i0, j0, i1, j1 } = cellRange(g, b.minX, b.minY, b.maxX, b.maxY);
  let best: Point | null = null;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = j * g.W + i;
      if (!occupied[k] || blocked[k]) continue;
      const p = cellCenter(g, k);
      if (pointInPolygon(p, polygon) && (!best || distance(p, c) < distance(best, c))) best = p;
    }
  }
  return best;
}
