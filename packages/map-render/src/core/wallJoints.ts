/**
 * Mối nối tường kiểu bản vẽ kiến trúc: các tường gặp nhau tại một đầu mút được vát (miter) theo
 * đường phân giác nên góc tường kín khít ở MỌI góc (không chỉ 90°), không hở ở góc ngoài, không chồng
 * ở góc trong (tường vách ngăn / vách kính bán trong suốt không bị đậm màu ở góc). Tường đâm vào
 * thân tường khác (chữ T) được cắt đúng theo mặt tường kia.
 *
 * Quy ước: pháp tuyến trái của tường n = (-dy, dx) với d = hướng start → end (giống `segmentQuad`).
 */
import {
  isSelfIntersecting,
  polygonSignedArea,
  projectPointOnSegment,
  wallLength,
  type Id,
  type Point,
  type Wall,
} from '@hwn/map-core';
import { segmentQuad, type WallSegment } from './walls';

/** Hai đầu mút cách nhau không quá ngưỡng này (m) được coi là cùng một mối nối. */
export const JOINT_TOLERANCE = 0.02;
/** Góc vát không được nhô xa tâm mối nối quá `MITER_LIMIT` lần nửa bề dày tường (góc quá nhọn). */
const MITER_LIMIT = 6;

/** Mép một đầu tường: điểm ở phía pháp tuyến trái (+n), phía phải (−n) và tâm mối nối (nếu có). */
export interface WallCap {
  plus: Point;
  minus: Point;
  /** Tâm mối nối — có khi ≥ 2 tường gặp nhau, để các tường cùng phủ kín phần lõi mối nối. */
  hub?: Point;
}

export interface WallJointCaps {
  start: WallCap;
  end: WallCap;
}

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const addScaled = (a: Point, d: Point, k: number): Point => ({
  x: a.x + d.x * k,
  y: a.y + d.y * k,
});
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Giao điểm hai đường thẳng `p + t·u` và `q + s·v` (null nếu gần song song). */
function lineIntersection(p: Point, u: Point, q: Point, v: Point): Point | null {
  const den = cross(u, v);
  if (Math.abs(den) < 1e-6) return null;
  const t = cross(sub(q, p), v) / den;
  return addScaled(p, u, t);
}

interface End {
  wall: Wall;
  which: 'start' | 'end';
  at: Point;
  /** Hướng đi từ mối nối vào thân tường (vector đơn vị). */
  u: Point;
  half: number;
}

/** Đầu tường cắt vuông ngay tại đầu mút (không kéo dài). */
function flushCap(e: End): { ccw: Point; cw: Point } {
  // ccw = phía quay +90° từ u: (-u.y, u.x); cw = phía ngược lại.
  return {
    ccw: { x: e.at.x - e.u.y * e.half, y: e.at.y + e.u.x * e.half },
    cw: { x: e.at.x + e.u.y * e.half, y: e.at.y - e.u.x * e.half },
  };
}

/** Chuyển mép theo phía của hướng `u` sang phía ±n của tường. */
function toCap(e: End, ccw: Point, cw: Point, hub?: Point): WallCap {
  // Đầu `start`: u = d → phía ccw (−u.y, u.x) chính là +n. Đầu `end`: u = −d → ccw là −n.
  return e.which === 'start' ? { plus: ccw, minus: cw, hub } : { plus: cw, minus: ccw, hub };
}

/**
 * Tính mép hai đầu của mọi tường trên một tầng.
 * - ≥ 2 tường chung đầu mút: vát theo giao tuyến mặt tường kề nhau (xếp theo góc quanh mối nối).
 * - Đầu tường chạm thân tường khác (chữ T): cắt theo mặt tường kia phía tường này đi tới.
 * - Đầu tự do: cắt vuông tại đầu mút.
 */
export function wallJoints(walls: readonly Wall[]): ReadonlyMap<Id, WallJointCaps> {
  // Dữ liệu tầng bất biến (editor sửa qua immer → mảng mới) nên nhớ kết quả theo mảng tường:
  // 2D, 3D và mỗi lần chuyển qua lại giữa hai chế độ dùng chung một lần tính.
  let joints = jointCache.get(walls);
  if (!joints) {
    joints = computeWallJoints(walls);
    jointCache.set(walls, joints);
  }
  return joints;
}

const jointCache = new WeakMap<readonly Wall[], ReadonlyMap<Id, WallJointCaps>>();

function computeWallJoints(walls: readonly Wall[]): Map<Id, WallJointCaps> {
  const ends: End[] = [];
  for (const wall of walls) {
    const len = wallLength(wall);
    if (len < 1e-6) continue;
    const d = { x: (wall.end.x - wall.start.x) / len, y: (wall.end.y - wall.start.y) / len };
    const half = Math.max(wall.thickness, 0.01) / 2;
    ends.push({ wall, which: 'start', at: wall.start, u: d, half });
    ends.push({ wall, which: 'end', at: wall.end, u: { x: -d.x, y: -d.y }, half });
  }

  // Gom đầu mút theo mối nối (lưới băm để không phải so từng cặp).
  const cell = (v: number) => Math.round(v / (JOINT_TOLERANCE * 4));
  const grid = new Map<string, End[][]>();
  const groups: End[][] = [];
  for (const e of ends) {
    const cx = cell(e.at.x);
    const cy = cell(e.at.y);
    let found: End[] | undefined;
    for (let i = -1; i <= 1 && !found; i++) {
      for (let j = -1; j <= 1 && !found; j++) {
        found = grid
          .get(`${cx + i},${cy + j}`)
          ?.find((g) => dist(g[0]!.at, e.at) <= JOINT_TOLERANCE);
      }
    }
    if (found) found.push(e);
    else {
      const g = [e];
      groups.push(g);
      const key = `${cx},${cy}`;
      grid.set(key, [...(grid.get(key) ?? []), g]);
    }
  }

  const caps = new Map<Id, Partial<WallJointCaps>>();
  const setCap = (e: End, cap: WallCap) => {
    const c = caps.get(e.wall.id) ?? {};
    c[e.which] = cap;
    caps.set(e.wall.id, c);
  };

  // Chỉ dựng lưới tìm tường gần khi thật sự có đầu tự do (cần tìm chữ T).
  let near: WallIndex | undefined;
  for (const group of groups) {
    if (group.length === 1) {
      const e = group[0]!;
      near ??= wallIndex(walls);
      setCap(e, teeCap(e, near.around(e.at)) ?? toCap(e, flushCap(e).ccw, flushCap(e).cw));
      continue;
    }
    // Tâm mối nối = trung bình các đầu mút (các đầu lệch nhau không quá JOINT_TOLERANCE).
    const hub = {
      x: group.reduce((s, e) => s + e.at.x, 0) / group.length,
      y: group.reduce((s, e) => s + e.at.y, 0) / group.length,
    };
    const sorted = [...group].sort((a, b) => Math.atan2(a.u.y, a.u.x) - Math.atan2(b.u.y, b.u.x));
    const n = sorted.length;
    // corner[i] = góc chung giữa mặt ccw của tường i và mặt cw của tường kế tiếp (i + 1).
    const ccwOf: Point[] = new Array(n);
    const cwOf: Point[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = sorted[i]!;
      const b = sorted[(i + 1) % n]!;
      const aSide = { x: -a.u.y, y: a.u.x }; // phía ccw của a
      const bSide = { x: b.u.y, y: -b.u.x }; // phía cw của b
      const pa = addScaled(hub, aSide, a.half);
      const pb = addScaled(hub, bSide, b.half);
      const c = lineIntersection(pa, a.u, pb, b.u);
      const limit = MITER_LIMIT * Math.max(a.half, b.half);
      if (c && dist(c, hub) <= limit) {
        ccwOf[i] = c;
        cwOf[(i + 1) % n] = c;
      } else {
        // Thẳng hàng (180°) hoặc góc quá nhọn: mỗi tường cắt vuông theo mặt của chính nó.
        ccwOf[i] = pa;
        cwOf[(i + 1) % n] = pb;
      }
    }
    sorted.forEach((e, i) => setCap(e, toCap(e, ccwOf[i]!, cwOf[i]!, hub)));
  }

  const out = new Map<Id, WallJointCaps>();
  for (const [id, c] of caps) {
    if (c.start && c.end) out.set(id, { start: c.start, end: c.end });
  }
  return out;
}

/** Cạnh ô lưới (m) của chỉ mục tìm tường gần một điểm. */
const INDEX_CELL = 2;
/** Tường dài phủ quá nhiều ô thì để ở danh sách chung (luôn được xét) thay vì rải vào lưới. */
const INDEX_MAX_CELLS = 256;

interface WallIndex {
  /** Các tường có thể chạm điểm `p` (giữ đúng thứ tự trong danh sách gốc). */
  around(p: Point): readonly Wall[];
}

/**
 * Lưới băm các tường theo khung bao (nới thêm tầm với của mối nối chữ T) để `teeCap` chỉ xét vài
 * tường quanh đầu mút thay vì cả tầng — tầng hàng nghìn tường không còn O(n²).
 */
function wallIndex(walls: readonly Wall[]): WallIndex {
  let maxHalf = 0;
  for (const w of walls) maxHalf = Math.max(maxHalf, Math.max(w.thickness, 0.01) / 2);
  const grid = new Map<string, number[]>();
  const always: number[] = [];
  const cell = (v: number) => Math.floor(v / INDEX_CELL);
  walls.forEach((w, i) => {
    // Đủ phủ mọi điểm cách tim tường ≤ w.thickness / 2 + e.half + JOINT_TOLERANCE (xem teeCap).
    const pad = w.thickness / 2 + maxHalf + JOINT_TOLERANCE;
    const x0 = cell(Math.min(w.start.x, w.end.x) - pad);
    const x1 = cell(Math.max(w.start.x, w.end.x) + pad);
    const y0 = cell(Math.min(w.start.y, w.end.y) - pad);
    const y1 = cell(Math.max(w.start.y, w.end.y) + pad);
    if (!Number.isFinite(x0 + x1 + y0 + y1) || (x1 - x0 + 1) * (y1 - y0 + 1) > INDEX_MAX_CELLS) {
      always.push(i);
      return;
    }
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = `${x},${y}`;
        const list = grid.get(key);
        if (list) list.push(i);
        else grid.set(key, [i]);
      }
    }
  });
  return {
    around(p) {
      const here = grid.get(`${cell(p.x)},${cell(p.y)}`) ?? [];
      if (always.length === 0) return here.map((i) => walls[i]!);
      // Gộp hai danh sách đã tăng dần để giữ thứ tự gốc (khi hoà khoảng cách, tường đứng trước thắng).
      const merged: Wall[] = [];
      let a = 0;
      let b = 0;
      while (a < here.length || b < always.length) {
        if (b >= always.length || (a < here.length && here[a]! < always[b]!)) {
          merged.push(walls[here[a++]!]!);
        } else merged.push(walls[always[b++]!]!);
      }
      return merged;
    },
  };
}

/**
 * Đầu tường chạm vào thân một tường khác (không trùng đầu mút): cắt theo mặt tường kia ở phía tường
 * này đi tới, để tường đâm vào khít mặt tường (không lòi sang, không hở khe).
 * @param walls các tường có thể chạm đầu mút (xem `wallIndex`).
 */
function teeCap(e: End, walls: readonly Wall[]): WallCap | null {
  let best: { wall: Wall; d: number; t: number } | null = null;
  for (const w of walls) {
    if (w === e.wall) continue;
    const pr = projectPointOnSegment(e.at, w.start, w.end);
    const reach = w.thickness / 2 + e.half + JOINT_TOLERANCE;
    if (pr.distance > reach) continue;
    const len = wallLength(w);
    // Gần đầu mút tường kia → không phải chữ T (để đầu cắt vuông).
    if (pr.t * len < JOINT_TOLERANCE || (1 - pr.t) * len < JOINT_TOLERANCE) continue;
    if (!best || pr.distance < best.d) best = { wall: w, d: pr.distance, t: pr.t };
  }
  if (!best) return null;
  const w = best.wall;
  const len = wallLength(w);
  const dw = { x: (w.end.x - w.start.x) / len, y: (w.end.y - w.start.y) / len };
  // Gần song song thì không cắt theo mặt (giao tuyến bắn ra xa).
  if (Math.abs(cross(dw, e.u)) < 0.25) return null;
  const nw = { x: -dw.y, y: dw.x };
  // Phía của tường này so với tim tường kia: lấy một điểm trong thân tường này.
  const inside = addScaled(e.at, e.u, Math.min(wallLength(e.wall) * 0.5, w.thickness + 0.5));
  const side = Math.sign(cross(dw, sub(inside, w.start))) || 1;
  const face = addScaled(w.start, nw, (side * w.thickness) / 2);
  const flush = flushCap(e);
  const ccw = lineIntersection(flush.ccw, e.u, face, dw);
  const cw = lineIntersection(flush.cw, e.u, face, dw);
  if (!ccw || !cw) return null;
  // Mặt cắt không được lùi quá sâu vào thân tường này (dữ liệu lỗi).
  if (dist(ccw, flush.ccw) > w.thickness * 3 || dist(cw, flush.cw) > w.thickness * 3) return null;
  return toCap(e, ccw, cw);
}

/**
 * Đa giác của một đoạn tường (đoạn đặc / ô cửa) có tính mối nối: đầu đoạn trùng đầu tường lấy mép
 * mối nối, đầu đoạn ở giữa tường (cạnh ô cửa) cắt vuông. Không có mối nối → như `segmentQuad`.
 */
export function segmentOutline(
  wall: Wall,
  segment: Pick<WallSegment, 'from' | 'to' | 'start' | 'end'>,
  caps?: WallJointCaps,
): Point[] {
  if (!caps) return segmentQuad(wall, segment);
  const len = wallLength(wall);
  const quad = segmentQuad(wall, segment);
  const atStart = segment.from <= 1e-6;
  const atEnd = segment.to >= len - 1e-6;
  if (!atStart && !atEnd) return quad;
  // segmentQuad: [start + n, end + n, end − n, start − n] (đầu tường đã kéo dài nửa bề dày).
  const half = wall.thickness / 2;
  const d = { x: (wall.end.x - wall.start.x) / len, y: (wall.end.y - wall.start.y) / len };
  const n = { x: -d.y * half, y: d.x * half };
  const sPlus = atStart ? caps.start.plus : { x: segment.start.x + n.x, y: segment.start.y + n.y };
  const sMinus = atStart
    ? caps.start.minus
    : { x: segment.start.x - n.x, y: segment.start.y - n.y };
  const ePlus = atEnd ? caps.end.plus : { x: segment.end.x + n.x, y: segment.end.y + n.y };
  const eMinus = atEnd ? caps.end.minus : { x: segment.end.x - n.x, y: segment.end.y - n.y };
  const poly: Point[] = [sPlus, ePlus];
  if (atEnd && caps.end.hub) poly.push(caps.end.hub);
  poly.push(eMinus, sMinus);
  if (atStart && caps.start.hub) poly.push(caps.start.hub);
  const clean = dedupe(poly);
  // Đoạn tường quá ngắn so với góc vát (mép hai đầu cắt chéo nhau) → về hình chữ nhật cũ.
  if (clean.length < 3 || isSelfIntersecting(clean) || Math.abs(polygonSignedArea(clean)) < 1e-6) {
    return quad;
  }
  return clean;
}

/** Bỏ các đỉnh trùng liên tiếp. */
function dedupe(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || dist(last, p) > 1e-6) out.push(p);
  }
  while (out.length > 1 && dist(out[0]!, out[out.length - 1]!) <= 1e-6) out.pop();
  return out;
}

/** Đưa đa giác về chiều dương (diện tích có dấu > 0) để tô chung một path không bị khe. */
export function orientPositive(points: readonly Point[]): Point[] {
  return polygonSignedArea(points) < 0 ? [...points].reverse() : [...points];
}
