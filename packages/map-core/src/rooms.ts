/**
 * Nhận diện vùng khép kín tạo bởi các bức tường — dùng để "click vào trong phòng" là tạo được
 * đa giác phòng mà không phải vẽ từng đỉnh.
 *
 * Thuật toán: dựng đồ thị phẳng từ đường tâm tường (tách đoạn tại mọi giao điểm, kể cả chỗ nối
 * chữ T), rồi duyệt các mặt (face) bằng quy tắc "rẽ theo cạnh kế tiếp theo chiều kim đồng hồ".
 * Các mặt bị chặn có diện tích có dấu dương; mặt bao ngoài có diện tích âm.
 */
import {
  cross,
  pointInPolygon,
  pointsEqual,
  polygonArea,
  polygonSignedArea,
  segmentIntersection,
  sub,
} from './geometry';
import type { Point, Wall } from './types';

const EPS = 1e-3;
const keyOf = (p: Point) => `${Math.round(p.x / EPS)},${Math.round(p.y / EPS)}`;

interface PlanarGraph {
  points: Map<string, Point>;
  /** Danh sách đỉnh kề, đã sắp theo góc tăng dần. */
  neighbors: Map<string, string[]>;
}

function buildPlanarGraph(walls: readonly Wall[]): PlanarGraph {
  const segs = walls
    .filter((w) => !pointsEqual(w.start, w.end, EPS))
    .map((w) => ({ a: w.start, b: w.end, ts: [0, 1] }));

  // Tách mỗi đoạn tại các giao điểm với đoạn khác.
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i]!;
      const o = segs[j]!;
      const p = segmentIntersection(s.a, s.b, o.a, o.b);
      if (!p) continue;
      const param = (seg: typeof s) => {
        const d = sub(seg.b, seg.a);
        const len2 = d.x * d.x + d.y * d.y;
        return ((p.x - seg.a.x) * d.x + (p.y - seg.a.y) * d.y) / len2;
      };
      s.ts.push(param(s));
      o.ts.push(param(o));
    }
  }

  const points = new Map<string, Point>();
  const edges = new Set<string>();
  const neighborSets = new Map<string, Set<string>>();
  const addPoint = (p: Point) => {
    const k = keyOf(p);
    if (!points.has(k)) points.set(k, { x: p.x, y: p.y });
    return k;
  };
  for (const s of segs) {
    const ts = [...new Set(s.ts.map((t) => Math.min(1, Math.max(0, t))))].sort((a, b) => a - b);
    for (let i = 1; i < ts.length; i++) {
      const p = {
        x: s.a.x + (s.b.x - s.a.x) * ts[i - 1]!,
        y: s.a.y + (s.b.y - s.a.y) * ts[i - 1]!,
      };
      const q = { x: s.a.x + (s.b.x - s.a.x) * ts[i]!, y: s.a.y + (s.b.y - s.a.y) * ts[i]! };
      const ka = addPoint(p);
      const kb = addPoint(q);
      if (ka === kb) continue;
      const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (edges.has(ek)) continue;
      edges.add(ek);
      for (const [x, y] of [
        [ka, kb],
        [kb, ka],
      ] as const) {
        const set = neighborSets.get(x) ?? new Set<string>();
        set.add(y);
        neighborSets.set(x, set);
      }
    }
  }

  const neighbors = new Map<string, string[]>();
  for (const [k, set] of neighborSets) {
    const p = points.get(k)!;
    neighbors.set(
      k,
      [...set].sort((a, b) => {
        const pa = points.get(a)!;
        const pb = points.get(b)!;
        return Math.atan2(pa.y - p.y, pa.x - p.x) - Math.atan2(pb.y - p.y, pb.x - p.x);
      }),
    );
  }
  return { points, neighbors };
}

/** Bỏ "gai" (đi ra rồi quay lại theo cùng đường — do tường cụt) và các đỉnh thẳng hàng. */
function cleanPolygon(poly: Point[]): Point[] {
  let pts = [...poly];
  let changed = true;
  while (changed && pts.length >= 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length]!;
      const cur = pts[i]!;
      const next = pts[(i + 1) % pts.length]!;
      if (pointsEqual(prev, next, EPS) || pointsEqual(prev, cur, EPS)) {
        // Gai: bỏ đỉnh hiện tại và một trong hai đỉnh trùng.
        pts.splice(i, pointsEqual(prev, next, EPS) ? 2 : 1);
        changed = true;
        break;
      }
      if (Math.abs(cross(sub(cur, prev), sub(next, cur))) < EPS * EPS * 10) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  pts = pts.map((p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }));
  return pts;
}

/** Tất cả vùng khép kín (mặt bị chặn) tạo bởi các bức tường. */
export function enclosedAreas(walls: readonly Wall[]): Point[][] {
  const g = buildPlanarGraph(walls);
  const visited = new Set<string>();
  const faces: Point[][] = [];

  for (const [u, nbrs] of g.neighbors) {
    for (const v of nbrs) {
      if (visited.has(`${u}>${v}`)) continue;
      const face: string[] = [];
      let a = u;
      let b = v;
      // Giới hạn số bước để chắc chắn không lặp vô hạn khi dữ liệu bất thường.
      for (let guard = 0; guard < 100_000; guard++) {
        visited.add(`${a}>${b}`);
        face.push(a);
        const around = g.neighbors.get(b)!;
        const i = around.indexOf(a);
        const c = around[(i - 1 + around.length) % around.length]!;
        a = b;
        b = c;
        if (a === u && b === v) break;
      }
      const poly = face.map((k) => g.points.get(k)!);
      if (polygonSignedArea(poly) > EPS) {
        const clean = cleanPolygon(poly);
        if (clean.length >= 3 && polygonArea(clean) > 0.05) faces.push(clean);
      }
    }
  }
  return faces;
}

/** Vùng khép kín nhỏ nhất chứa điểm `p`, hoặc null nếu `p` không nằm trong vùng kín nào. */
export function enclosedAreaAt(walls: readonly Wall[], p: Point): Point[] | null {
  let best: { poly: Point[]; area: number } | null = null;
  for (const poly of enclosedAreas(walls)) {
    if (!pointInPolygon(p, poly)) continue;
    const area = polygonArea(poly);
    if (!best || area < best.area) best = { poly, area };
  }
  return best?.poly ?? null;
}
