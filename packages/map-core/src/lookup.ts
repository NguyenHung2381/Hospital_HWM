import { boundsOf, pointInPolygon, projectPointOnSegment } from './geometry';
import type {
  Building,
  Connector,
  Department,
  Floor,
  Id,
  Landmark,
  LandmarkKind,
  Point,
  Room,
} from './types';

export const findFloor = (building: Building, floorId: Id): Floor | undefined =>
  building.floors.find((f) => f.id === floorId);

export const findDepartment = (building: Building, departmentId: Id): Department | undefined =>
  building.departments.find((d) => d.id === departmentId);

export interface RoomRef {
  floor: Floor;
  room: Room;
}

export function findRoom(building: Building, roomId: Id): RoomRef | undefined {
  for (const floor of building.floors) {
    const room = floor.rooms.find((r) => r.id === roomId);
    if (room) return { floor, room };
  }
  return undefined;
}

export interface LandmarkRef {
  floor: Floor;
  landmark: Landmark;
}

export function findLandmark(building: Building, landmarkId: Id): LandmarkRef | undefined {
  for (const floor of building.floors) {
    const landmark = floor.landmarks?.find((l) => l.id === landmarkId);
    if (landmark) return { floor, landmark };
  }
  return undefined;
}

/** Tên hiển thị của từng loại mốc (theo thứ tự hiển thị trong danh sách chọn). */
export const LANDMARK_KINDS: Record<LandmarkKind, string> = {
  info: 'Quầy thông tin',
  kiosk: 'Máy lấy số',
  cashier: 'Quầy thu ngân',
  pharmacy: 'Quầy thuốc',
  restroom: 'Nhà vệ sinh',
  atm: 'ATM',
  water: 'Nước uống',
  waiting: 'Khu chờ',
  canteen: 'Căng tin',
  other: 'Mốc khác',
};

/** Điểm đích đến của phòng: `room.destination` nếu nằm trong phòng, ngược lại undefined. */
export const roomDestination = (room: Room): Point | undefined =>
  room.destination && pointInPolygon(room.destination, room.polygon) ? room.destination : undefined;

/** Các tầng sắp xếp theo `level` tăng dần. */
export const sortedFloors = (building: Building): Floor[] =>
  [...building.floors].sort((a, b) => a.level - b.level);

/** Bỏ dấu tiếng Việt + chữ thường, để tìm kiếm không phân biệt dấu. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

export interface RoomSearchResult extends RoomRef {
  department?: Department;
}

/** Tìm phòng theo tên, mã, tag hoặc tên khoa (không phân biệt dấu). */
export function searchRooms(building: Building, query: string): RoomSearchResult[] {
  const q = normalizeText(query);
  const results: RoomSearchResult[] = [];
  for (const floor of sortedFloors(building)) {
    for (const room of floor.rooms) {
      const department = room.departmentId
        ? findDepartment(building, room.departmentId)
        : undefined;
      const haystack = normalizeText(
        [room.name, room.code, ...room.tags, department?.name ?? '', department?.code ?? ''].join(
          ' ',
        ),
      );
      if (!q || haystack.includes(q)) results.push({ floor, room, department });
    }
  }
  return results;
}

export type LandmarkSearchResult = LandmarkRef;

/** Tìm mốc theo tên, loại hoặc tag (không phân biệt dấu). */
export function searchLandmarks(building: Building, query: string): LandmarkSearchResult[] {
  const q = normalizeText(query);
  const results: LandmarkSearchResult[] = [];
  for (const floor of sortedFloors(building)) {
    for (const landmark of floor.landmarks ?? []) {
      const haystack = normalizeText(
        [landmark.name, LANDMARK_KINDS[landmark.kind], ...landmark.tags].join(' '),
      );
      if (!q || haystack.includes(q)) results.push({ floor, landmark });
    }
  }
  return results;
}

/* ------------------------------------------------------------------ */
/* La bàn                                                              */
/* ------------------------------------------------------------------ */

/** Hướng Bắc trên mặt bằng, theo quy ước heading (độ, 0 = trục +x, theo chiều kim đồng hồ). */
export const northHeading = (building: Pick<Building, 'northAngle'>): number =>
  normalizeAngle((building.northAngle ?? 0) - 90);

/** Đổi hướng la bàn (độ, 0 = Bắc, 90 = Đông) sang heading trên mặt bằng. */
export const compassToHeading = (building: Pick<Building, 'northAngle'>, compass: number) =>
  normalizeAngle(northHeading(building) + compass);

/** Đổi heading trên mặt bằng sang hướng la bàn (độ, 0 = Bắc). */
export const headingToCompass = (building: Pick<Building, 'northAngle'>, heading: number) =>
  normalizeAngle(heading - northHeading(building));

const normalizeAngle = (deg: number) => ((deg % 360) + 360) % 360;

/** Phòng chứa điểm `p`, hoặc phòng gần `p` nhất trong phạm vi `maxDistance` (m). */
export function nearestRoom(
  floor: Floor,
  p: Point,
  maxDistance = 5,
): { room: Room; inside: boolean; distance: number } | null {
  const inside = floor.rooms.find((r) => pointInPolygon(p, r.polygon));
  if (inside) return { room: inside, inside: true, distance: 0 };
  let best: { room: Room; inside: boolean; distance: number } | null = null;
  for (const room of floor.rooms) {
    let d = Infinity;
    for (let i = 0; i < room.polygon.length; i++) {
      const a = room.polygon[i]!;
      const b = room.polygon[(i + 1) % room.polygon.length]!;
      d = Math.min(d, projectPointOnSegment(p, a, b).distance);
    }
    if (d <= maxDistance && (!best || d < best.distance))
      best = { room, inside: false, distance: d };
  }
  return best;
}

/** Hướng đi lên (độ) của thang: `heading` nếu có, ngược lại dọc cạnh dài về phía x/y tăng. */
export function connectorHeading(c: Pick<Connector, 'heading' | 'polygon'>): number {
  if (c.heading !== undefined) return ((c.heading % 360) + 360) % 360;
  const b = boundsOf(c.polygon);
  if (!b) return 0;
  return b.maxX - b.minX >= b.maxY - b.minY ? 0 : 90;
}
