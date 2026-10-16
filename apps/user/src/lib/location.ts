import {
  findFloor,
  pointInPolygon,
  projectPointOnSegment,
  type Building,
  type Id,
  type Point,
  type Room,
} from '@hwn/map-core';
import type { MapLocation } from '@hwn/map-render';

/** Vị trí cửa ra vào chính (nút `entrance` đầu tiên trong đồ thị). */
export function entranceLocation(building: Building): MapLocation | null {
  for (const floor of building.floors) {
    const node = floor.navGraph.nodes.find((n) => n.kind === 'entrance');
    if (node) return { floorId: floor.id, position: { ...node.position } };
  }
  return null;
}

/**
 * Đọc vị trí từ tham số QR `?at=<floorId>,<x>,<y>` (QR dán ở các điểm cố định trong viện;
 * toà nhà nằm ở tham số `b` riêng).
 * Trả null nếu sai định dạng hoặc tầng không tồn tại.
 */
export function parseAtParam(value: string | null, building: Building): MapLocation | null {
  if (!value) return null;
  const [floorId, xs, ys] = value.split(',');
  const x = Number(xs);
  const y = Number(ys);
  if (!floorId || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (!findFloor(building, floorId)) return null;
  return { floorId, position: { x, y } };
}

/** Tạo giá trị tham số `at` (dùng khi in mã QR). */
export const formatAtParam = (loc: MapLocation) =>
  `${loc.floorId},${loc.position.x.toFixed(2)},${loc.position.y.toFixed(2)}`;

/** Chuỗi truy vấn đầy đủ của mã QR: `b=<toà>&at=<tầng>,<x>,<y>` (dùng khi in mã QR). */
export const formatQrQuery = (buildingId: Id, loc: MapLocation) =>
  new URLSearchParams({ b: buildingId, at: formatAtParam(loc) }).toString();

function distanceToPolygon(p: Point, polygon: readonly Point[]): number {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const d = projectPointOnSegment(p, polygon[i]!, polygon[(i + 1) % polygon.length]!).distance;
    best = Math.min(best, d);
  }
  return best;
}

export interface LocationDescription {
  floorName: string;
  /** "trong" / "gần" một phòng, hoặc không có. */
  relation: 'in' | 'near' | null;
  room: Room | null;
}

/** Mô tả vị trí cho người dùng: tầng + phòng chứa điểm hoặc phòng gần nhất (≤ `nearMeters`). */
export function describeLocation(
  building: Building,
  loc: MapLocation,
  nearMeters = 5,
): LocationDescription {
  const floor = findFloor(building, loc.floorId);
  if (!floor) return { floorName: loc.floorId, relation: null, room: null };
  const inside = floor.rooms.find((r) => pointInPolygon(loc.position, r.polygon));
  if (inside) return { floorName: floor.name, relation: 'in', room: inside };
  let nearest: { room: Room; d: number } | null = null;
  for (const room of floor.rooms) {
    const d = distanceToPolygon(loc.position, room.polygon);
    if (d <= nearMeters && (!nearest || d < nearest.d)) nearest = { room, d };
  }
  return { floorName: floor.name, relation: nearest ? 'near' : null, room: nearest?.room ?? null };
}

export function locationText(d: LocationDescription): string {
  if (!d.room) return d.floorName;
  const label = d.room.code ? `${d.room.name} (${d.room.code})` : d.room.name;
  return `${d.floorName} · ${d.relation === 'in' ? 'trong' : 'gần'} ${label}`;
}

/** Chỉ chấp nhận đường dẫn nội bộ cho `returnTo` (tránh chuyển hướng ra trang ngoài). */
export const safeReturnTo = (value: string | null) =>
  value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
