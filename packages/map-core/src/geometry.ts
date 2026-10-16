import type { Point, Wall } from './types';

export const EPSILON = 1e-9;

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/* ------------------------------------------------------------------ */
/* Vector cơ bản                                                       */
/* ------------------------------------------------------------------ */

export const vec = (x: number, y: number): Point => ({ x, y });
export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
export const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
export const length = (a: Point): number => Math.hypot(a.x, a.y);
export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
export const pointsEqual = (a: Point, b: Point, eps = 1e-6): boolean =>
  Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;

export function normalize(a: Point): Point {
  const len = length(a);
  return len < EPSILON ? { x: 0, y: 0 } : { x: a.x / len, y: a.y / len };
}

/** Góc của vector (radian, -π..π). Vì trục y hướng xuống nên góc dương là theo chiều kim đồng hồ. */
export const angleOf = (a: Point): number => Math.atan2(a.y, a.x);

/** Góc có hướng (radian, -π..π) để quay từ `a` sang `b`. Dương = rẽ phải (trục y hướng xuống). */
export const signedAngleBetween = (a: Point, b: Point): number =>
  Math.atan2(cross(a, b), dot(a, b));

export const toDegrees = (rad: number): number => (rad * 180) / Math.PI;
export const toRadians = (deg: number): number => (deg * Math.PI) / 180;

/* ------------------------------------------------------------------ */
/* Đoạn thẳng                                                          */
/* ------------------------------------------------------------------ */

export interface SegmentProjection {
  /** Tham số trên đoạn, đã kẹp vào 0..1. */
  t: number;
  point: Point;
  distance: number;
}

/** Chiếu điểm `p` lên đoạn thẳng `a`-`b`. */
export function projectPointOnSegment(p: Point, a: Point, b: Point): SegmentProjection {
  const ab = sub(b, a);
  const lenSq = dot(ab, ab);
  const t = lenSq < EPSILON ? 0 : Math.min(1, Math.max(0, dot(sub(p, a), ab) / lenSq));
  const point = lerp(a, b, t);
  return { t, point, distance: distance(p, point) };
}

/**
 * Giao điểm của hai đoạn thẳng `p1-p2` và `p3-p4`. Trả về null nếu không cắt nhau
 * hoặc song song/trùng nhau.
 */
export function segmentIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const r = sub(p2, p1);
  const s = sub(p4, p3);
  const denom = cross(r, s);
  if (Math.abs(denom) < EPSILON) return null;
  const qp = sub(p3, p1);
  const t = cross(qp, s) / denom;
  const u = cross(qp, r) / denom;
  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) return null;
  return lerp(p1, p2, t);
}

export function polylineLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1]!, points[i]!);
  return total;
}

/* ------------------------------------------------------------------ */
/* Tường                                                               */
/* ------------------------------------------------------------------ */

export const wallLength = (wall: Pick<Wall, 'start' | 'end'>): number =>
  distance(wall.start, wall.end);

/** Điểm nằm trên tường, cách `wall.start` một khoảng `offset` (m). */
export function pointOnWall(wall: Pick<Wall, 'start' | 'end'>, offset: number): Point {
  const len = wallLength(wall);
  return len < EPSILON ? { ...wall.start } : lerp(wall.start, wall.end, offset / len);
}

/** Khoảng cách dọc theo tường từ `wall.start` tới hình chiếu của `p`. */
export function offsetAlongWall(wall: Pick<Wall, 'start' | 'end'>, p: Point): number {
  return projectPointOnSegment(p, wall.start, wall.end).t * wallLength(wall);
}

/* ------------------------------------------------------------------ */
/* Đa giác                                                             */
/* ------------------------------------------------------------------ */

/** Diện tích có dấu (công thức shoelace). */
export function polygonSignedArea(polygon: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export const polygonArea = (polygon: readonly Point[]): number =>
  Math.abs(polygonSignedArea(polygon));

/** Trọng tâm hình học của đa giác (rơi về trung bình các đỉnh nếu diện tích ~ 0). */
export function polygonCentroid(polygon: readonly Point[]): Point {
  const area = polygonSignedArea(polygon);
  if (Math.abs(area) < EPSILON) {
    const n = polygon.length || 1;
    const s = polygon.reduce((acc, p) => add(acc, p), vec(0, 0));
    return scale(s, 1 / n);
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const f = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * f;
    cy += (a.y + b.y) * f;
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

/** Kiểm tra điểm nằm trong đa giác (ray casting). Điểm trên cạnh có thể trả về true hoặc false. */
export function pointInPolygon(p: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** true nếu có hai cạnh không kề nhau cắt nhau. */
export function isSelfIntersecting(polygon: readonly Point[]): boolean {
  const n = polygon.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = polygon[i]!;
    const a2 = polygon[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      // Cạnh cuối kề với cạnh đầu.
      if (i === 0 && j === n - 1) continue;
      const b1 = polygon[j]!;
      const b2 = polygon[(j + 1) % n]!;
      if (segmentIntersection(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Khung bao                                                           */
/* ------------------------------------------------------------------ */

export function boundsOf(points: Iterable<Point>): BBox | null {
  let box: BBox | null = null;
  for (const p of points) {
    if (!box) box = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
    else {
      box.minX = Math.min(box.minX, p.x);
      box.minY = Math.min(box.minY, p.y);
      box.maxX = Math.max(box.maxX, p.x);
      box.maxY = Math.max(box.maxY, p.y);
    }
  }
  return box;
}

/* ------------------------------------------------------------------ */
/* Snap (dùng trong editor)                                            */
/* ------------------------------------------------------------------ */

export function snapToGrid(p: Point, gridSize: number): Point {
  if (gridSize <= 0) return { ...p };
  return { x: Math.round(p.x / gridSize) * gridSize, y: Math.round(p.y / gridSize) * gridSize };
}

/**
 * Ràng buộc `p` để đoạn `origin`-`p` có góc là bội số của `stepDeg` (mặc định 45°),
 * giữ nguyên độ dài hình chiếu.
 */
export function snapAngle(origin: Point, p: Point, stepDeg = 45): Point {
  const d = sub(p, origin);
  const len = length(d);
  if (len < EPSILON) return { ...p };
  const step = toRadians(stepDeg);
  const angle = Math.round(angleOf(d) / step) * step;
  const dir = vec(Math.cos(angle), Math.sin(angle));
  return add(origin, scale(dir, dot(d, dir)));
}

/** Trả về điểm gần `p` nhất trong `candidates` nếu nằm trong bán kính `radius`. */
export function snapToPoints(p: Point, candidates: Iterable<Point>, radius: number): Point | null {
  let best: Point | null = null;
  let bestDist = radius;
  for (const c of candidates) {
    const d = distance(p, c);
    if (d <= bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best ? { ...best } : null;
}

/* ------------------------------------------------------------------ */
/* Hướng (độ)                                                          */
/* ------------------------------------------------------------------ */

/** Chuẩn hoá góc (độ) về [0, 360). */
export const normalizeDegrees = (deg: number): number => ((deg % 360) + 360) % 360;

/** Vector đơn vị theo hướng `deg` (0 = +x, 90 = +y). */
export const directionOf = (deg: number): Point => {
  const r = toRadians(deg);
  // Làm tròn để các hướng chẵn 90° cho đúng 0/±1 (tránh 6e-17).
  return { x: Math.round(Math.cos(r) * 1e9) / 1e9, y: Math.round(Math.sin(r) * 1e9) / 1e9 };
};

/** Xoay điểm `p` quanh `center` một góc `deg` (độ, chiều kim đồng hồ khi y hướng xuống). */
export function rotatePoint(p: Point, center: Point, deg: number): Point {
  const d = directionOf(deg);
  const rel = sub(p, center);
  return { x: center.x + rel.x * d.x - rel.y * d.y, y: center.y + rel.x * d.y + rel.y * d.x };
}

/**
 * Đường song song cách `d` m. Dương = bên PHẢI khi đi theo chiều vẽ nhìn trên bản đồ (trục y hướng
 * xuống), tức pháp tuyến (-dy, dx). Góc nối kiểu vát nhọn (miter), giới hạn để không bắn ra xa.
 */
export function offsetPolyline(points: readonly Point[], d: number): Point[] {
  if (points.length < 2) return [...points];
  const normals = points.slice(1).map((b, i) => {
    const a = points[i]!;
    const len = distance(a, b) || 1;
    return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  });
  return points.map((p, i) => {
    const n0 = normals[Math.max(0, i - 1)]!;
    const n1 = normals[Math.min(normals.length - 1, i)]!;
    const nx = n0.x + n1.x;
    const ny = n0.y + n1.y;
    const len = Math.hypot(nx, ny);
    if (len < 1e-6) return { x: p.x + n1.x * d, y: p.y + n1.y * d };
    const cos = (n0.x * nx + n0.y * ny) / len; // cos nửa góc giữa hai pháp tuyến
    const k = d / Math.max(cos, 0.35);
    return { x: p.x + (nx / len) * k, y: p.y + (ny / len) * k };
  });
}

/**
 * Làm mượt đường gấp khúc bằng cắt góc Chaikin: giữ nguyên hai đầu mút và hướng của đoạn đầu /
 * đoạn cuối (nên chỗ nối với đường khác vẫn tiếp tuyến), các góc gãy thành cung tròn trơn.
 */
/** Đơn giản hoá đường gấp khúc (Douglas–Peucker), sai lệch tối đa `tol` m. */
export function simplifyPolyline(points: readonly Point[], tol: number): Point[] {
  if (points.length <= 2) return [...points];
  const a = points[0]!;
  const b = points[points.length - 1]!;
  let maxD = -1;
  let idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = projectPointOnSegment(points[i]!, a, b).distance;
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= tol) return [a, b];
  return [
    ...simplifyPolyline(points.slice(0, idx + 1), tol).slice(0, -1),
    ...simplifyPolyline(points.slice(idx), tol),
  ];
}

/** Đơn giản hoá đa giác khép kín (Douglas–Peucker), sai lệch tối đa `tol` m. */
export function simplifyPolygon(polygon: readonly Point[], tol: number): Point[] {
  if (polygon.length <= 3) return [...polygon];
  // Tách đa giác thành hai nửa tại đỉnh 0 và đỉnh xa nó nhất rồi đơn giản hoá từng nửa.
  const first = polygon[0]!;
  let far = 1;
  for (let i = 2; i < polygon.length; i++) {
    if (distance(polygon[i]!, first) > distance(polygon[far]!, first)) far = i;
  }
  const out = [
    ...simplifyPolyline(polygon.slice(0, far + 1), tol).slice(0, -1),
    ...simplifyPolyline([...polygon.slice(far), first], tol).slice(0, -1),
  ];
  return out.length >= 3 ? out : [...polygon];
}

export function smoothPolyline(points: readonly Point[], iterations = 3): Point[] {
  let pts = [...points];
  if (pts.length < 3) return pts;
  for (let k = 0; k < iterations; k++) {
    const next: Point[] = [pts[0]!];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const q = { x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y };
      const r = { x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y };
      if (i > 0) next.push(q);
      if (i + 2 < pts.length) next.push(r);
    }
    next.push(pts[pts.length - 1]!);
    pts = next;
  }
  return pts;
}
