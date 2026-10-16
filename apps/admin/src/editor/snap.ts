/** Bắt dính (snap) và xác định đối tượng dưới con trỏ — hàm thuần, toạ độ theo mét. */
import {
  add,
  distance,
  normalize,
  pointInPolygon,
  pointOnWall,
  projectPointOnSegment,
  scale,
  snapAngle,
  snapToGrid,
  snapToPoints,
  sub,
  type Floor,
  type Id,
  type Point,
} from '@hwn/map-core';
import type { EndpointRef, ItemRef } from './types';

export type SnapKind = 'endpoint' | 'wall' | 'angle' | 'grid' | 'free';

export interface SnapResult {
  point: Point;
  kind: SnapKind;
}

export interface SnapOptions {
  floor: Floor;
  /** Bán kính bắt dính (m) — thường quy đổi từ ~10 px theo mức zoom. */
  radius: number;
  gridSize: number;
  snapGrid: boolean;
  snapObjects: boolean;
  /** Điểm trước đó khi đang vẽ — dùng để khoá góc. */
  from?: Point;
  /** Bước góc (độ); 0 = không khoá góc. */
  angleStep?: number;
  /** Bỏ qua các tường này (vd. tường đang được kéo). */
  excludeWallIds?: ReadonlySet<Id>;
}

/**
 * Thứ tự ưu tiên: đầu mút tường > khoá góc (kèm làm tròn độ dài theo lưới) > thân tường > lưới.
 */
export function snapPoint(p: Point, o: SnapOptions): SnapResult {
  const walls = o.floor.walls.filter((w) => !o.excludeWallIds?.has(w.id));

  if (o.snapObjects) {
    const endpoint = snapToPoints(
      p,
      walls.flatMap((w) => [w.start, w.end]),
      o.radius,
    );
    if (endpoint) return { point: endpoint, kind: 'endpoint' };
  }

  if (o.from && o.angleStep) {
    const constrained = snapAngle(o.from, p, o.angleStep);
    const len = distance(o.from, constrained);
    if (o.snapGrid && o.gridSize > 0 && len > 0) {
      const dir = normalize(sub(constrained, o.from));
      const rounded = Math.round(len / o.gridSize) * o.gridSize;
      return { point: add(o.from, scale(dir, rounded)), kind: 'angle' };
    }
    return { point: constrained, kind: 'angle' };
  }

  if (o.snapObjects) {
    let best: { point: Point; d: number } | null = null;
    for (const w of walls) {
      const proj = projectPointOnSegment(p, w.start, w.end);
      if (proj.distance <= o.radius && (!best || proj.distance < best.d)) {
        best = { point: proj.point, d: proj.distance };
      }
    }
    if (best) return { point: best.point, kind: 'wall' };
  }

  if (o.snapGrid && o.gridSize > 0) return { point: snapToGrid(p, o.gridSize), kind: 'grid' };
  return { point: { ...p }, kind: 'free' };
}

/** Làm tròn độ dời theo lưới khi kéo đối tượng. */
export const snapDelta = (d: Point, gridSize: number, enabled: boolean): Point =>
  enabled && gridSize > 0 ? snapToGrid(d, gridSize) : d;

/** Nút đồ thị gần `p` nhất trong bán kính `tol`. */
export function hitNavNode(floor: Floor, p: Point, tol: number): Id | null {
  let best: { id: Id; d: number } | null = null;
  for (const n of floor.navGraph.nodes) {
    const d = distance(p, n.position);
    if (d <= tol && (!best || d < best.d)) best = { id: n.id, d };
  }
  return best?.id ?? null;
}

/**
 * Đối tượng dưới con trỏ, theo thứ tự ưu tiên:
 * (nút đồ thị) > ô cửa > thang > tường > (cạnh đồ thị) > phòng.
 * Nút/cạnh đồ thị chỉ xét khi `nav` = true (đồ thị đang hiện).
 * @param tol dung sai (m), thường quy đổi từ vài pixel.
 */
export function hitTest(
  floor: Floor,
  p: Point,
  tol: number,
  opts: { nav?: boolean } = {},
): ItemRef | null {
  const walls = new Map(floor.walls.map((w) => [w.id, w]));

  if (opts.nav) {
    const node = hitNavNode(floor, p, tol * 1.2);
    if (node) return { type: 'navNode', id: node };
  }

  const landmark = hitLandmark(floor, p, tol);
  if (landmark) return { type: 'landmark', id: landmark };

  for (const o of floor.openings) {
    const wall = walls.get(o.wallId);
    if (!wall) continue;
    const a = pointOnWall(wall, o.offset - o.width / 2);
    const b = pointOnWall(wall, o.offset + o.width / 2);
    if (projectPointOnSegment(p, a, b).distance <= wall.thickness / 2 + tol) {
      return { type: 'opening', id: o.id };
    }
  }

  for (const c of [...floor.connectors].reverse()) {
    if (pointInPolygon(p, c.polygon)) return { type: 'connector', id: c.id };
  }

  let best: { id: Id; d: number } | null = null;
  for (const w of floor.walls) {
    const d = projectPointOnSegment(p, w.start, w.end).distance;
    if (d <= w.thickness / 2 + tol && (!best || d < best.d)) best = { id: w.id, d };
  }
  if (best) return { type: 'wall', id: best.id };

  if (opts.nav) {
    const nodes = new Map(floor.navGraph.nodes.map((n) => [n.id, n]));
    for (const e of floor.navGraph.edges) {
      const a = nodes.get(e.from);
      const b = nodes.get(e.to);
      if (a && b && projectPointOnSegment(p, a.position, b.position).distance <= tol) {
        return { type: 'navEdge', id: e.id };
      }
    }
  }

  // Phòng xét sau cùng: click vào khoảng trống trong phòng mới chọn phòng.
  for (const r of [...floor.rooms].reverse()) {
    if (pointInPolygon(p, r.polygon)) return { type: 'room', id: r.id };
  }
  return null;
}

/** Biểu tượng mốc có bán kính ~11 px, lớn hơn dung sai chọn thông thường (`tol` ~8 px). */
export function hitLandmark(floor: Floor, p: Point, tol: number): Id | null {
  let best: { id: Id; d: number } | null = null;
  for (const l of floor.landmarks ?? []) {
    const d = distance(l.position, p);
    if (d <= tol * 1.6 && (!best || d < best.d)) best = { id: l.id, d };
  }
  return best?.id ?? null;
}

/** Con trỏ nằm trên tay nắm điểm đích đến của phòng `roomId`. */
export function hitRoomDestination(floor: Floor, roomId: Id, p: Point, tol: number): boolean {
  const room = floor.rooms.find((r) => r.id === roomId);
  return !!room?.destination && distance(room.destination, p) <= tol * 1.5;
}

/** Tay nắm đỉnh của các phòng đang chọn nằm dưới con trỏ. */
export function hitRoomVertex(
  floor: Floor,
  roomIds: ReadonlySet<Id>,
  p: Point,
  tol: number,
): { roomId: Id; index: number; point: Point } | null {
  for (const r of floor.rooms) {
    if (!roomIds.has(r.id)) continue;
    const index = r.polygon.findIndex((v) => distance(p, v) <= tol);
    if (index >= 0) return { roomId: r.id, index, point: r.polygon[index]! };
  }
  return null;
}

/** Tay nắm đầu mút của các tường đang chọn nằm dưới con trỏ. */
export function hitEndpointHandle(
  floor: Floor,
  wallIds: ReadonlySet<Id>,
  p: Point,
  tol: number,
): (EndpointRef & { point: Point }) | null {
  for (const w of floor.walls) {
    if (!wallIds.has(w.id)) continue;
    for (const which of ['start', 'end'] as const) {
      if (distance(p, w[which]) <= tol) return { wallId: w.id, which, point: w[which] };
    }
  }
  return null;
}
