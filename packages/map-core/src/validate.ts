import { groundFloor } from './campus';
import { isSelfIntersecting, pointInPolygon, polygonArea, wallLength } from './geometry';
import type { Building, Floor, Id } from './types';

export type IssueSeverity = 'error' | 'warning';

export type IssueCode =
  | 'DUPLICATE_ID'
  | 'DUPLICATE_LEVEL'
  | 'ZERO_LENGTH_WALL'
  | 'INVALID_DIMENSION'
  | 'OPENING_MISSING_WALL'
  | 'OPENING_OUT_OF_WALL'
  | 'OPENINGS_OVERLAP'
  | 'INVALID_POLYGON'
  | 'SELF_INTERSECTING_POLYGON'
  | 'UNKNOWN_DEPARTMENT'
  | 'NAV_EDGE_MISSING_NODE'
  | 'NAV_REF_MISSING'
  | 'ROOM_NOT_IN_GRAPH'
  | 'CONNECTOR_NOT_IN_GRAPH'
  | 'CONNECTOR_UNLINKED'
  | 'NAV_DISCONNECTED'
  | 'DUPLICATE_ROOM_CODE'
  | 'DESTINATION_OUTSIDE_ROOM'
  | 'EMPTY_NAME'
  | 'EXTERIOR_INVALID_SHAPE';

export interface ValidationIssue {
  severity: IssueSeverity;
  code: IssueCode;
  message: string;
  floorId?: Id;
  /** ID của đối tượng gặp vấn đề — editor dùng để chọn/zoom tới. */
  refId?: Id;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

const result = (issues: ValidationIssue[]): ValidationResult => ({
  valid: !issues.some((i) => i.severity === 'error'),
  issues,
});

/** Kiểm tra một tầng. `departmentIds` (nếu có) dùng để kiểm tra tham chiếu khoa của phòng. */
export function validateFloor(floor: Floor, departmentIds?: ReadonlySet<Id>): ValidationResult {
  const issues: ValidationIssue[] = [];
  const push = (severity: IssueSeverity, code: IssueCode, message: string, refId?: Id) =>
    issues.push({ severity, code, message, floorId: floor.id, refId });

  // ID trùng lặp trong tầng.
  const seen = new Set<Id>();
  const all = [
    ...floor.walls,
    ...floor.openings,
    ...floor.connectors,
    ...floor.rooms,
    ...(floor.landmarks ?? []),
    ...floor.navGraph.nodes,
    ...floor.navGraph.edges,
  ];
  for (const item of all) {
    if (seen.has(item.id)) push('error', 'DUPLICATE_ID', `ID "${item.id}" bị trùng`, item.id);
    seen.add(item.id);
  }

  // Tường.
  const walls = new Map(floor.walls.map((w) => [w.id, w]));
  for (const wall of floor.walls) {
    if (wallLength(wall) < 0.01) push('error', 'ZERO_LENGTH_WALL', 'Tường có độ dài 0', wall.id);
    if (wall.thickness <= 0 || wall.height <= 0) {
      push('error', 'INVALID_DIMENSION', 'Độ dày/chiều cao tường phải > 0', wall.id);
    }
  }

  // Cửa.
  const openingsByWall = new Map<Id, Floor['openings']>();
  for (const opening of floor.openings) {
    const wall = walls.get(opening.wallId);
    if (!wall) {
      push('error', 'OPENING_MISSING_WALL', 'Cửa không gắn với tường nào', opening.id);
      continue;
    }
    if (opening.width <= 0 || opening.height <= 0) {
      push('error', 'INVALID_DIMENSION', 'Kích thước cửa phải > 0', opening.id);
    }
    const half = opening.width / 2;
    if (opening.offset - half < -1e-6 || opening.offset + half > wallLength(wall) + 1e-6) {
      push('error', 'OPENING_OUT_OF_WALL', 'Cửa vượt ra ngoài phạm vi tường', opening.id);
    }
    const list = openingsByWall.get(wall.id) ?? [];
    list.push(opening);
    openingsByWall.set(wall.id, list);
  }
  for (const list of openingsByWall.values()) {
    const sorted = [...list].sort((a, b) => a.offset - b.offset);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      if (prev.offset + prev.width / 2 > cur.offset - cur.width / 2 + 1e-6) {
        push('warning', 'OPENINGS_OVERLAP', 'Hai cửa chồng lên nhau trên cùng một tường', cur.id);
      }
    }
  }

  // Đa giác phòng & thang.
  for (const shape of [...floor.rooms, ...floor.connectors]) {
    if (shape.polygon.length < 3 || polygonArea(shape.polygon) < 0.01) {
      push('error', 'INVALID_POLYGON', `"${shape.name}" có vùng không hợp lệ`, shape.id);
    } else if (isSelfIntersecting(shape.polygon)) {
      push('error', 'SELF_INTERSECTING_POLYGON', `"${shape.name}" có cạnh tự cắt nhau`, shape.id);
    }
  }
  for (const room of floor.rooms) {
    if (
      room.destination &&
      room.polygon.length >= 3 &&
      !pointInPolygon(room.destination, room.polygon)
    ) {
      push(
        'warning',
        'DESTINATION_OUTSIDE_ROOM',
        `Điểm đích đến của "${room.name}" nằm ngoài phòng — sẽ bị bỏ qua`,
        room.id,
      );
    }
  }

  // Mốc.
  for (const landmark of floor.landmarks ?? []) {
    if (!landmark.name.trim()) push('error', 'EMPTY_NAME', 'Mốc chưa có tên', landmark.id);
  }

  if (departmentIds) {
    for (const room of floor.rooms) {
      if (room.departmentId && !departmentIds.has(room.departmentId)) {
        push(
          'error',
          'UNKNOWN_DEPARTMENT',
          `Phòng "${room.name}" thuộc khoa không tồn tại`,
          room.id,
        );
      }
    }
  }

  // Đồ thị đi lại.
  const nodes = new Map(floor.navGraph.nodes.map((n) => [n.id, n]));
  for (const edge of floor.navGraph.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) {
      push('error', 'NAV_EDGE_MISSING_NODE', 'Cạnh nối tới nút không tồn tại', edge.id);
    }
  }
  const refIds = new Set<Id>([
    ...floor.rooms.map((r) => r.id),
    ...floor.connectors.map((c) => c.id),
    ...floor.openings.map((o) => o.id),
  ]);
  const referenced = new Set<Id>();
  for (const node of floor.navGraph.nodes) {
    if (!node.refId) continue;
    referenced.add(node.refId);
    if (!refIds.has(node.refId)) {
      push('error', 'NAV_REF_MISSING', 'Nút tham chiếu tới đối tượng không tồn tại', node.id);
    }
  }
  for (const room of floor.rooms) {
    if (!referenced.has(room.id)) {
      push(
        'warning',
        'ROOM_NOT_IN_GRAPH',
        `Phòng "${room.name}" chưa có trong đồ thị đi lại — không thể chỉ đường tới`,
        room.id,
      );
    }
  }
  for (const connector of floor.connectors) {
    if (!referenced.has(connector.id)) {
      push(
        'warning',
        'CONNECTOR_NOT_IN_GRAPH',
        `"${connector.name}" chưa có trong đồ thị đi lại`,
        connector.id,
      );
    }
  }

  // Đồ thị bị chia cắt: các nút ngoài thành phần liên thông lớn nhất không đi tới được.
  const components = navComponents(floor);
  if (components.length > 1) {
    const [, ...others] = components.sort((a, b) => b.length - a.length);
    for (const comp of others) {
      const ref = comp.find((n) => n.refId) ?? comp[0]!;
      push(
        'warning',
        'NAV_DISCONNECTED',
        `Một phần đồ thị đi lại (${comp.length} nút) bị tách rời, không đi tới được từ phần còn lại`,
        ref.refId ?? ref.id,
      );
    }
  }

  return result(issues);
}

/** Kiểm tra toàn bộ toà nhà, bao gồm các quan hệ giữa các tầng. */
export function validateBuilding(building: Building): ValidationResult {
  const issues: ValidationIssue[] = [];
  const departmentIds = new Set(building.departments.map((d) => d.id));

  const floorIds = new Set<Id>();
  const levels = new Map<number, Id>();
  for (const floor of building.floors) {
    if (floorIds.has(floor.id)) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_ID',
        message: `ID tầng "${floor.id}" bị trùng`,
        refId: floor.id,
      });
    }
    floorIds.add(floor.id);
    if (levels.has(floor.level)) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_LEVEL',
        message: `Có nhiều tầng cùng số thứ tự ${floor.level}`,
        floorId: floor.id,
      });
    }
    levels.set(floor.level, floor.id);
    issues.push(...validateFloor(floor, departmentIds).issues);
  }

  // Mã phòng phải duy nhất trong toà nhà (người dùng tìm theo mã).
  const codes = new Map<string, Id>();
  for (const floor of building.floors) {
    for (const room of floor.rooms) {
      const code = room.code.trim().toLowerCase();
      if (!code) continue;
      if (codes.has(code)) {
        issues.push({
          severity: 'warning',
          code: 'DUPLICATE_ROOM_CODE',
          message: `Mã phòng "${room.code}" bị trùng`,
          floorId: floor.id,
          refId: room.id,
        });
      } else {
        codes.set(code, room.id);
      }
    }
  }

  // Thang chỉ xuất hiện ở một tầng thì không nối đi đâu cả.
  const floorsByLink = new Map<Id, Set<Id>>();
  for (const floor of building.floors) {
    for (const c of floor.connectors) {
      const set = floorsByLink.get(c.linkId) ?? new Set<Id>();
      set.add(floor.id);
      floorsByLink.set(c.linkId, set);
    }
  }
  for (const floor of building.floors) {
    for (const c of floor.connectors) {
      if ((floorsByLink.get(c.linkId)?.size ?? 0) < 2) {
        issues.push({
          severity: 'warning',
          code: 'CONNECTOR_UNLINKED',
          message: `"${c.name}" không nối với tầng nào khác`,
          floorId: floor.id,
          refId: c.id,
        });
      }
    }
  }

  // Sảnh, dốc… ngoài toà (vẽ ở tầng trệt).
  const ground = groundFloor(building)?.id;
  const ext = building.exterior;
  for (const a of ext?.areas ?? []) {
    if (a.polygon.length < 3) {
      issues.push({
        severity: 'error',
        code: 'EXTERIOR_INVALID_SHAPE',
        message: `Khu vực ngoài toà "${a.name || a.kind}" cần ít nhất 3 đỉnh`,
        floorId: ground,
        refId: a.id,
      });
    }
  }
  for (const p of ext?.paths ?? []) {
    if (p.points.length < 2 || !(p.width > 0)) {
      issues.push({
        severity: 'error',
        code: 'EXTERIOR_INVALID_SHAPE',
        message: `Đường ngoài toà "${p.name || p.kind}" cần ít nhất 2 điểm và bề rộng > 0`,
        floorId: ground,
        refId: p.id,
      });
    }
  }

  return result(issues);
}

/** Các thành phần liên thông của đồ thị đi lại một tầng. */
function navComponents(floor: Floor) {
  const adj = new Map<Id, Id[]>(floor.navGraph.nodes.map((n) => [n.id, []]));
  for (const e of floor.navGraph.edges) {
    adj.get(e.from)?.push(e.to);
    adj.get(e.to)?.push(e.from);
  }
  const byId = new Map(floor.navGraph.nodes.map((n) => [n.id, n]));
  const seen = new Set<Id>();
  const components: (typeof floor.navGraph.nodes)[] = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const comp = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const id = stack.pop()!;
      comp.push(byId.get(id)!);
      for (const nb of adj.get(id) ?? []) {
        if (!seen.has(nb)) {
          seen.add(nb);
          stack.push(nb);
        }
      }
    }
    components.push(comp);
  }
  return components;
}
