/**
 * Các thao tác chỉnh sửa bản đồ dạng hàm thuần.
 * Hầu hết hàm SỬA TRỰC TIẾP đối tượng truyền vào — store gọi chúng bên trong `produce` của immer.
 */
import {
  add,
  angleOf,
  furniturePolygon,
  boundsOf,
  createId,
  distance,
  dot,
  offsetAlongWall,
  pointInPolygon,
  pointOnWall,
  pointsEqual,
  polygonCentroid,
  projectPointOnSegment,
  rotatePoint,
  scale,
  segmentIntersection,
  sub,
  toDegrees,
  toRadians,
  wallLength,
  type Annotation,
  type BBox,
  type Building,
  type Connector,
  type ConnectorType,
  type DimensionAnnotation,
  type DoorStyle,
  type ElevatorKind,
  type Floor,
  type FloorBackground,
  type Furniture,
  type FurnitureKind,
  type Id,
  type Landmark,
  type LandmarkKind,
  type NavEdge,
  type NavNode,
  type Opening,
  type OpeningType,
  type Point,
  type Room,
  type TextAnnotation,
  type Wall,
  type WallKind,
} from '@hwn/map-core';
import { FURNITURE, segmentQuad } from '@hwn/map-render';
import { current, isDraft, type Draft } from 'immer';
import { normalizeAngle } from './furniture';
import type { Clipboard, EndpointRef, ItemRef, LayerId } from './types';

/**
 * Sao chép sâu, dùng được cả với draft của immer (structuredClone không clone được Proxy).
 * Các hàm trong file này thường chạy bên trong `produce`.
 */
const deepClone = <T>(value: T): T =>
  structuredClone(isDraft(value) ? (current(value as Draft<T>) as T) : value);

export const OPENING_DEFAULTS: Record<
  OpeningType,
  { width: number; height: number; sillHeight: number }
> = {
  door: { width: 1, height: 2.2, sillHeight: 0 },
  window: { width: 1.5, height: 1.4, sillHeight: 0.9 },
  entrance: { width: 2.4, height: 2.4, sillHeight: 0 },
};

/** Độ rộng mặc định (m) của cửa đi mới theo kiểu cánh. */
export const DOOR_STYLE_WIDTH: Record<DoorStyle, number> = {
  single: 1,
  double: 1.6,
  sliding: 1.2,
  automatic: 2,
  opening: 1.2,
};

/** Độ rộng mặc định khi đặt ô cửa mới (cửa đi tính theo kiểu cánh đang chọn). */
export const newOpeningWidth = (type: OpeningType, doorStyle: DoorStyle) =>
  type === 'door' ? DOOR_STYLE_WIDTH[doorStyle] : OPENING_DEFAULTS[type].width;

export const CONNECTOR_DEFAULTS: Record<
  ConnectorType,
  { width: number; depth: number; label: string }
> = {
  elevator: { width: 2.4, depth: 2.4, label: 'Thang máy' },
  stairs: { width: 2.6, depth: 5, label: 'Thang bộ' },
  escalator: { width: 1.4, depth: 8, label: 'Thang cuốn' },
};

/** Độ dày (m) mặc định theo loại tường; `height` bỏ trống = cao bằng tầng. */
export const WALL_KIND_DEFAULTS: Record<WallKind, { thickness: number; height?: number }> = {
  brick: { thickness: 0.2 },
  concrete: { thickness: 0.3 },
  partition: { thickness: 0.1 },
  glass: { thickness: 0.1 },
  railing: { thickness: 0.1, height: 1.1 },
};

/** Kích thước mặc định (m) của thang máy mới theo loại. */
export const ELEVATOR_KIND_SIZE: Record<ElevatorKind, { width: number; depth: number }> = {
  passenger: { width: 2.4, depth: 2.4 },
  priority: { width: 2.4, depth: 2.4 },
  bed: { width: 2.4, depth: 3.2 },
  service: { width: 2.8, depth: 2.8 },
};

/** Kích thước mặc định khi đặt thang mới (thang máy tính theo loại đang chọn). */
export const newConnectorSize = (type: ConnectorType, elevatorKind: ElevatorKind) =>
  type === 'elevator' ? ELEVATOR_KIND_SIZE[elevatorKind] : CONNECTOR_DEFAULTS[type];

const MIN_WALL_LENGTH = 0.05;

export const rectPolygon = (center: Point, width: number, depth: number): Point[] => [
  { x: center.x - width / 2, y: center.y - depth / 2 },
  { x: center.x + width / 2, y: center.y - depth / 2 },
  { x: center.x + width / 2, y: center.y + depth / 2 },
  { x: center.x - width / 2, y: center.y + depth / 2 },
];

/* ------------------------------------------------------------------ */
/* Tường                                                               */
/* ------------------------------------------------------------------ */

export function addWall(
  floor: Floor,
  start: Point,
  end: Point,
  opts: { thickness: number; height?: number; kind?: WallKind },
): Wall | null {
  if (distance(start, end) < MIN_WALL_LENGTH) return null;
  const kind = opts.kind ?? 'brick';
  const wall: Wall = {
    id: createId('wall'),
    start: { ...start },
    end: { ...end },
    thickness: opts.thickness,
    height: opts.height ?? WALL_KIND_DEFAULTS[kind].height ?? floor.height,
  };
  if (kind !== 'brick') wall.kind = kind;
  floor.walls.push(wall);
  return wall;
}

/**
 * Vẽ 4 bức tường theo hình chữ nhật có hai góc đối diện `a`, `b` (các góc dùng chung điểm nên
 * kéo một góc sẽ kéo cả hai tường). Trả về [] nếu hình quá dẹt.
 */
export function addRectWalls(
  floor: Floor,
  a: Point,
  b: Point,
  opts: { thickness: number; height?: number; kind?: WallKind },
): Wall[] {
  const r = rectFromPoints(a, b);
  if (r.maxX - r.minX < MIN_WALL_LENGTH || r.maxY - r.minY < MIN_WALL_LENGTH) return [];
  const c = rectCorners(r);
  return c.map((p, i) => addWall(floor, p, c[(i + 1) % 4]!, opts)!);
}

/** Tất cả đầu mút tường trùng với điểm `p` (dùng để kéo khớp nối giữa nhiều tường). */
export function endpointsAt(floor: Floor, p: Point, eps = 1e-3): EndpointRef[] {
  const refs: EndpointRef[] = [];
  for (const w of floor.walls) {
    if (pointsEqual(w.start, p, eps)) refs.push({ wallId: w.id, which: 'start' });
    if (pointsEqual(w.end, p, eps)) refs.push({ wallId: w.id, which: 'end' });
  }
  return refs;
}

/** Kẹp các ô cửa của tường vào trong chiều dài mới của tường. */
export function clampOpenings(floor: Floor, wallId: Id) {
  const wall = floor.walls.find((w) => w.id === wallId);
  if (!wall) return;
  const len = wallLength(wall);
  for (const o of floor.openings) {
    if (o.wallId !== wallId) continue;
    o.width = Math.min(o.width, len);
    o.offset = Math.min(Math.max(o.offset, o.width / 2), len - o.width / 2);
  }
}

export function setEndpoints(floor: Floor, refs: readonly EndpointRef[], to: Point) {
  const touched = new Set<Id>();
  for (const ref of refs) {
    const wall = floor.walls.find((w) => w.id === ref.wallId);
    if (!wall) continue;
    wall[ref.which] = { ...to };
    touched.add(wall.id);
  }
  for (const id of touched) clampOpenings(floor, id);
}

/**
 * Kế hoạch kéo: lưu vị trí ban đầu để mỗi lần di chuột tính lại từ gốc (không bị trôi số).
 * Đầu mút của tường KHÔNG được chọn nhưng nối với tường được chọn sẽ bị kéo giãn theo.
 */
export interface DragPlan {
  walls: { id: Id; start: Point; end: Point }[];
  joints: (EndpointRef & { origin: Point })[];
  connectors: { id: Id; polygon: Point[] }[];
  rooms: { id: Id; polygon: Point[]; destination?: Point }[];
  landmarks: { id: Id; position: Point }[];
  /** Bản gốc của các ghi chú được chọn. */
  annotations: Annotation[];
  /** Bản gốc của nội thất / thiết bị được chọn. */
  furniture: Furniture[];
  /** Nút đồ thị được chọn, kèm nút đại diện của phòng/thang đang được kéo. */
  navNodes: { id: Id; position: Point }[];
}

export function makeDragPlan(floor: Floor, selection: readonly ItemRef[]): DragPlan {
  const wallIds = new Set(selection.filter((r) => r.type === 'wall').map((r) => r.id));
  const walls = floor.walls
    .filter((w) => wallIds.has(w.id))
    .map((w) => ({ id: w.id, start: { ...w.start }, end: { ...w.end } }));
  const joints: DragPlan['joints'] = [];
  for (const w of walls) {
    for (const p of [w.start, w.end]) {
      for (const ref of endpointsAt(floor, p)) {
        if (wallIds.has(ref.wallId)) continue;
        if (joints.some((j) => j.wallId === ref.wallId && j.which === ref.which)) continue;
        joints.push({ ...ref, origin: { ...p } });
      }
    }
  }
  const connectorIds = new Set(selection.filter((r) => r.type === 'connector').map((r) => r.id));
  const connectors = floor.connectors
    .filter((c) => connectorIds.has(c.id))
    .map((c) => ({ id: c.id, polygon: c.polygon.map((p) => ({ ...p })) }));
  const roomIds = new Set(selection.filter((r) => r.type === 'room').map((r) => r.id));
  const rooms = floor.rooms
    .filter((r) => roomIds.has(r.id))
    .map((r) => ({
      id: r.id,
      polygon: r.polygon.map((p) => ({ ...p })),
      destination: r.destination && { ...r.destination },
    }));
  const landmarkIds = new Set(selection.filter((r) => r.type === 'landmark').map((r) => r.id));
  const landmarks = (floor.landmarks ?? [])
    .filter((l) => landmarkIds.has(l.id))
    .map((l) => ({ id: l.id, position: { ...l.position } }));
  const annotationIds = new Set(selection.filter((r) => r.type === 'annotation').map((r) => r.id));
  const annotations = (floor.annotations ?? [])
    .filter((a) => annotationIds.has(a.id))
    .map(deepClone);
  const furnitureIds = new Set(selection.filter((r) => r.type === 'furniture').map((r) => r.id));
  const furniture = (floor.furniture ?? []).filter((f) => furnitureIds.has(f.id)).map(deepClone);
  const nodeIds = new Set(selection.filter((r) => r.type === 'navNode').map((r) => r.id));
  const navNodes = floor.navGraph.nodes
    .filter(
      (n) =>
        nodeIds.has(n.id) ||
        (n.refId &&
          (n.kind === 'room' ? roomIds : n.kind === 'connector' ? connectorIds : null)?.has(
            n.refId,
          )),
    )
    .map((n) => ({ id: n.id, position: { ...n.position } }));
  return { walls, joints, connectors, rooms, landmarks, annotations, furniture, navNodes };
}

/** Áp một phép biến đổi điểm `fn` lên mọi đối tượng trong kế hoạch (tính từ vị trí gốc). */
export function applyTransform(floor: Floor, plan: DragPlan, fn: (p: Point) => Point) {
  for (const w of plan.walls) {
    const wall = floor.walls.find((x) => x.id === w.id);
    if (!wall) continue;
    wall.start = fn(w.start);
    wall.end = fn(w.end);
  }
  for (const j of plan.joints) {
    const wall = floor.walls.find((x) => x.id === j.wallId);
    if (!wall) continue;
    wall[j.which] = fn(j.origin);
    clampOpenings(floor, wall.id);
  }
  for (const c of plan.connectors) {
    const connector = floor.connectors.find((x) => x.id === c.id);
    if (connector) connector.polygon = c.polygon.map(fn);
  }
  for (const r of plan.rooms) {
    const room = floor.rooms.find((x) => x.id === r.id);
    if (!room) continue;
    room.polygon = r.polygon.map(fn);
    if (r.destination) room.destination = fn(r.destination);
  }
  for (const l of plan.landmarks) {
    const landmark = floor.landmarks?.find((x) => x.id === l.id);
    if (landmark) landmark.position = fn(l.position);
  }
  for (const a of plan.annotations) {
    const i = floor.annotations?.findIndex((x) => x.id === a.id) ?? -1;
    if (i >= 0) floor.annotations![i] = transformAnnotation(a, fn);
  }
  for (const f of plan.furniture) {
    const i = floor.furniture?.findIndex((x) => x.id === f.id) ?? -1;
    if (i >= 0) floor.furniture![i] = transformFurniture(f, fn);
  }
  for (const n of plan.navNodes) {
    const node = floor.navGraph.nodes.find((x) => x.id === n.id);
    if (node) node.position = fn(n.position);
  }
}

export function applyDrag(floor: Floor, plan: DragPlan, delta: Point) {
  applyTransform(floor, plan, (p) => add(p, delta));
}

export type TransformKind = 'rotate' | 'flipX' | 'flipY';

/** Hộp bao của các đối tượng được chọn (ô cửa tính theo tâm). */
export function selectionBounds(floor: Floor, refs: readonly ItemRef[]): BBox | null {
  const points: Point[] = [];
  const node = (id: Id) => floor.navGraph.nodes.find((n) => n.id === id);
  for (const r of refs) {
    if (r.type === 'wall') {
      const w = floor.walls.find((x) => x.id === r.id);
      if (w) points.push(w.start, w.end);
    } else if (r.type === 'room' || r.type === 'connector') {
      const list: readonly { id: Id; polygon: Point[] }[] =
        r.type === 'room' ? floor.rooms : floor.connectors;
      const shape = list.find((x) => x.id === r.id);
      if (shape) points.push(...shape.polygon);
    } else if (r.type === 'opening') {
      const o = floor.openings.find((x) => x.id === r.id);
      const w = o && floor.walls.find((x) => x.id === o.wallId);
      if (o && w) points.push(pointOnWall(w, o.offset));
    } else if (r.type === 'navNode') {
      const n = node(r.id);
      if (n) points.push(n.position);
    } else if (r.type === 'landmark') {
      const l = floor.landmarks?.find((x) => x.id === r.id);
      if (l) points.push(l.position);
    } else if (r.type === 'annotation') {
      const a = floor.annotations?.find((x) => x.id === r.id);
      if (a) points.push(...annotationPoints(a));
    } else if (r.type === 'furniture') {
      const f = floor.furniture?.find((x) => x.id === r.id);
      if (f) points.push(...furnitureCorners(f));
    } else {
      const e = floor.navGraph.edges.find((x) => x.id === r.id);
      for (const n of e ? [node(e.from), node(e.to)] : []) if (n) points.push(n.position);
    }
  }
  return boundsOf(points);
}

/**
 * Xoay 90° theo chiều kim đồng hồ hoặc lật ngang/dọc các đối tượng được chọn quanh tâm hộp bao.
 * Đầu tường không được chọn nhưng nối vào sẽ kéo giãn theo (giống khi kéo).
 */
export function transformItems(floor: Floor, refs: readonly ItemRef[], kind: TransformKind) {
  const b = selectionBounds(floor, refs);
  if (!b) return;
  const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  const fn =
    kind === 'rotate'
      ? (p: Point) => rotatePoint(p, c, 90)
      : kind === 'flipX'
        ? (p: Point) => ({ x: 2 * c.x - p.x, y: p.y })
        : (p: Point) => ({ x: p.x, y: 2 * c.y - p.y });
  applyTransform(floor, makeDragPlan(floor, refs), fn);
}

export type AlignMode = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';

/** Từng đối tượng dời được kèm hộp bao (ô cửa đi theo tường, cạnh đồ thị đi theo nút — bỏ qua). */
function movableBoxes(floor: Floor, refs: readonly ItemRef[]) {
  return refs.flatMap((r) => {
    if (r.type === 'opening' || r.type === 'navEdge') return [];
    const b = selectionBounds(floor, [r]);
    return b ? [{ ref: r, b }] : [];
  });
}

/**
 * Dời từng đối tượng đi một đoạn riêng. Kế hoạch kéo lập từ vị trí gốc trước khi dời cái nào.
 * ponytail: mỗi đối tượng dời độc lập — hai tường được chọn nối chung một đầu mà dời lệch nhau thì
 * bị tách ra; muốn giữ khớp thì gom các tường nối nhau thành một nhóm trước khi căn.
 */
function moveEach(floor: Floor, moves: readonly { ref: ItemRef; delta: Point }[]) {
  const plans = moves.map((m) => ({ plan: makeDragPlan(floor, [m.ref]), delta: m.delta }));
  for (const { plan, delta } of plans) {
    if (Math.abs(delta.x) > 1e-9 || Math.abs(delta.y) > 1e-9) applyDrag(floor, plan, delta);
  }
}

/** Căn các đối tượng được chọn theo mép / tâm của hộp bao chung. */
export function alignItems(floor: Floor, refs: readonly ItemRef[], mode: AlignMode) {
  const boxes = movableBoxes(floor, refs);
  const all = selectionBounds(
    floor,
    boxes.map((x) => x.ref),
  );
  if (boxes.length < 2 || !all) return;
  const horizontal = mode === 'left' || mode === 'centerX' || mode === 'right';
  const key = (b: BBox) =>
    mode === 'left'
      ? b.minX
      : mode === 'right'
        ? b.maxX
        : mode === 'top'
          ? b.minY
          : mode === 'bottom'
            ? b.maxY
            : horizontal
              ? (b.minX + b.maxX) / 2
              : (b.minY + b.maxY) / 2;
  const target = key(all);
  moveEach(
    floor,
    boxes.map(({ ref, b }) => {
      const d = target - key(b);
      return { ref, delta: horizontal ? { x: d, y: 0 } : { x: 0, y: d } };
    }),
  );
}

/**
 * Chia đều khoảng hở giữa các đối tượng theo trục ngang (`x`) hoặc dọc (`y`): hai đối tượng ngoài
 * cùng giữ nguyên, các đối tượng ở giữa dời sao cho khoảng trống giữa hai cái liền nhau bằng nhau.
 */
export function distributeItems(floor: Floor, refs: readonly ItemRef[], axis: 'x' | 'y') {
  const lo = axis === 'x' ? 'minX' : 'minY';
  const hi = axis === 'x' ? 'maxX' : 'maxY';
  const boxes = movableBoxes(floor, refs).sort((a, b) => a.b[lo] + a.b[hi] - (b.b[lo] + b.b[hi]));
  if (boxes.length < 3) return;
  const first = boxes[0]!.b;
  const last = boxes[boxes.length - 1]!.b;
  const sizes = boxes.reduce((s, x) => s + (x.b[hi] - x.b[lo]), 0);
  const gap = (last[hi] - first[lo] - sizes) / (boxes.length - 1);
  let cursor = first[lo];
  moveEach(
    floor,
    boxes.map(({ ref, b }) => {
      const d = cursor - b[lo];
      cursor += b[hi] - b[lo] + gap;
      return { ref, delta: axis === 'x' ? { x: d, y: 0 } : { x: 0, y: d } };
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Chọn theo vùng                                                      */
/* ------------------------------------------------------------------ */

export const rectFromPoints = (a: Point, b: Point): BBox => ({
  minX: Math.min(a.x, b.x),
  minY: Math.min(a.y, b.y),
  maxX: Math.max(a.x, b.x),
  maxY: Math.max(a.y, b.y),
});

const inRect = (p: Point, r: BBox) =>
  p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;

const rectCorners = (r: BBox): Point[] => [
  { x: r.minX, y: r.minY },
  { x: r.maxX, y: r.minY },
  { x: r.maxX, y: r.maxY },
  { x: r.minX, y: r.maxY },
];

function segmentTouchesRect(a: Point, b: Point, r: BBox): boolean {
  if (inRect(a, r) || inRect(b, r)) return true;
  const c = rectCorners(r);
  return c.some((p, i) => segmentIntersection(a, b, p, c[(i + 1) % 4]!) !== null);
}

function polygonTouchesRect(poly: readonly Point[], r: BBox): boolean {
  if (poly.some((p, i) => segmentTouchesRect(p, poly[(i + 1) % poly.length]!, r))) return true;
  // Vùng chọn nằm gọn bên trong đa giác.
  return pointInPolygon({ x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 }, poly);
}

/**
 * Đối tượng trong vùng chữ nhật `r`.
 * - `contain`: phải nằm gọn trong vùng (kéo từ trái sang phải).
 * - `cross`: chỉ cần chạm vào vùng (kéo từ phải sang trái).
 * Ô cửa chỉ được chọn riêng khi tường chứa nó không được chọn (cửa luôn đi theo tường).
 */
export function itemsInRect(
  floor: Floor,
  r: BBox,
  mode: 'contain' | 'cross',
  opts: { nav?: boolean } = {},
): ItemRef[] {
  const seg = (a: Point, b: Point) =>
    mode === 'contain' ? inRect(a, r) && inRect(b, r) : segmentTouchesRect(a, b, r);
  const poly = (pts: readonly Point[]) =>
    mode === 'contain' ? pts.every((p) => inRect(p, r)) : polygonTouchesRect(pts, r);

  const refs: ItemRef[] = [];
  const wallIds = new Set<Id>();
  for (const w of floor.walls) {
    if (!seg(w.start, w.end)) continue;
    wallIds.add(w.id);
    refs.push({ type: 'wall', id: w.id });
  }
  for (const o of floor.openings) {
    const w = floor.walls.find((x) => x.id === o.wallId);
    if (!w || wallIds.has(w.id)) continue;
    const a = pointOnWall(w, o.offset - o.width / 2);
    const b = pointOnWall(w, o.offset + o.width / 2);
    if (seg(a, b)) refs.push({ type: 'opening', id: o.id });
  }
  for (const c of floor.connectors) if (poly(c.polygon)) refs.push({ type: 'connector', id: c.id });
  for (const room of floor.rooms) if (poly(room.polygon)) refs.push({ type: 'room', id: room.id });
  for (const l of floor.landmarks ?? []) {
    if (inRect(l.position, r)) refs.push({ type: 'landmark', id: l.id });
  }
  for (const a of floor.annotations ?? []) {
    const pts = annotationPoints(a);
    // Kích thước: xét đường kích thước (2 điểm cuối); chữ: khối chữ.
    const hit = a.kind === 'text' ? poly(pts) : seg(pts[2]!, pts[3]!);
    if (hit) refs.push({ type: 'annotation', id: a.id });
  }
  for (const f of floor.furniture ?? []) {
    if (poly(furnitureCorners(f))) refs.push({ type: 'furniture', id: f.id });
  }
  if (opts.nav) {
    const nodes = new Map(floor.navGraph.nodes.map((n) => [n.id, n]));
    for (const n of floor.navGraph.nodes) {
      if (inRect(n.position, r)) refs.push({ type: 'navNode', id: n.id });
    }
    for (const e of floor.navGraph.edges) {
      const a = nodes.get(e.from);
      const b = nodes.get(e.to);
      if (a && b && seg(a.position, b.position)) refs.push({ type: 'navEdge', id: e.id });
    }
  }
  return refs;
}

/** Tất cả đối tượng trên tầng (Ctrl+A). Ô cửa đi theo tường nên không tính riêng. */
export function allItems(floor: Floor, opts: { nav?: boolean } = {}): ItemRef[] {
  return [
    ...floor.walls.map((w) => ({ type: 'wall' as const, id: w.id })),
    ...floor.connectors.map((c) => ({ type: 'connector' as const, id: c.id })),
    ...floor.rooms.map((r) => ({ type: 'room' as const, id: r.id })),
    ...(floor.landmarks ?? []).map((l) => ({ type: 'landmark' as const, id: l.id })),
    ...(floor.annotations ?? []).map((a) => ({ type: 'annotation' as const, id: a.id })),
    ...(floor.furniture ?? []).map((f) => ({ type: 'furniture' as const, id: f.id })),
    ...(opts.nav ? floor.navGraph.nodes.map((n) => ({ type: 'navNode' as const, id: n.id })) : []),
  ];
}

/* ------------------------------------------------------------------ */
/* Phòng                                                               */
/* ------------------------------------------------------------------ */

export function nextRoomName(building: Building): string {
  const count = building.floors.reduce((sum, f) => sum + f.rooms.length, 0);
  return `Phòng ${count + 1}`;
}

export function addRoom(
  floor: Floor,
  polygon: readonly Point[],
  opts: { name: string; code?: string; departmentId?: Id | null },
): Room {
  const room: Room = {
    id: createId('room'),
    name: opts.name,
    code: opts.code ?? '',
    polygon: polygon.map((p) => ({ x: p.x, y: p.y })),
    departmentId: opts.departmentId ?? null,
    tags: [],
  };
  floor.rooms.push(room);
  return room;
}

export function setRoomVertex(floor: Floor, roomId: Id, index: number, to: Point) {
  const room = floor.rooms.find((r) => r.id === roomId);
  if (room && room.polygon[index]) room.polygon[index] = { ...to };
}

/* ------------------------------------------------------------------ */
/* Đồ thị đi lại                                                        */
/* ------------------------------------------------------------------ */

export function addNavNode(
  floor: Floor,
  position: Point,
  kind: NavNode['kind'] = 'corridor',
  refId?: Id,
): NavNode {
  const node: NavNode = { id: createId('nav'), kind, position: { ...position }, refId };
  floor.navGraph.nodes.push(node);
  return node;
}

/** Thêm cạnh giữa hai nút (bỏ qua nếu đã có hoặc a === b). */
export function addNavEdge(floor: Floor, from: Id, to: Id): NavEdge | null {
  if (from === to) return null;
  const exists = floor.navGraph.edges.some(
    (e) => (e.from === from && e.to === to) || (e.from === to && e.to === from),
  );
  if (exists) return null;
  const edge: NavEdge = { id: createId('edge'), from, to };
  floor.navGraph.edges.push(edge);
  return edge;
}

/* ------------------------------------------------------------------ */
/* Ô cửa                                                               */
/* ------------------------------------------------------------------ */

export interface OpeningPlacement {
  wallId: Id;
  offset: number;
  /** Chồng lên ô cửa khác trên cùng tường. */
  overlaps: boolean;
}

/**
 * Tìm vị trí đặt ô cửa rộng `width` gần điểm `p` nhất, trên tường cách `p` không quá `maxDist`.
 * @param ignoreOpeningId bỏ qua ô cửa này khi kiểm tra chồng lấn (dùng khi đang kéo nó).
 */
export function findOpeningPlacement(
  floor: Floor,
  p: Point,
  width: number,
  maxDist: number,
  ignoreOpeningId?: Id,
): OpeningPlacement | null {
  let best: { wall: Wall; dist: number } | null = null;
  for (const wall of floor.walls) {
    if (wallLength(wall) < width) continue;
    const d = projectPointOnSegment(p, wall.start, wall.end).distance - wall.thickness / 2;
    if (d <= maxDist && (!best || d < best.dist)) best = { wall, dist: d };
  }
  if (!best) return null;
  const len = wallLength(best.wall);
  const offset = Math.min(Math.max(offsetAlongWall(best.wall, p), width / 2), len - width / 2);
  const overlaps = floor.openings.some(
    (o) =>
      o.id !== ignoreOpeningId &&
      o.wallId === best.wall.id &&
      Math.abs(o.offset - offset) < (o.width + width) / 2 - 1e-6,
  );
  return { wallId: best.wall.id, offset, overlaps };
}

export function addOpening(
  floor: Floor,
  type: OpeningType,
  placement: Pick<OpeningPlacement, 'wallId' | 'offset'>,
  width = OPENING_DEFAULTS[type].width,
  style?: DoorStyle,
): Opening {
  const d = OPENING_DEFAULTS[type];
  const opening: Opening = {
    id: createId(type === 'window' ? 'win' : 'door'),
    type,
    wallId: placement.wallId,
    offset: placement.offset,
    width,
    height: d.height,
    sillHeight: d.sillHeight,
  };
  if (style && type !== 'window') opening.style = style;
  floor.openings.push(opening);
  return opening;
}

/** Trượt ô cửa tới gần điểm `p` (có thể chuyển sang tường khác ở gần). */
export function moveOpening(floor: Floor, openingId: Id, p: Point, maxDist: number) {
  const opening = floor.openings.find((o) => o.id === openingId);
  if (!opening) return;
  const placement = findOpeningPlacement(floor, p, opening.width, maxDist, openingId);
  if (!placement || placement.overlaps) return;
  opening.wallId = placement.wallId;
  opening.offset = placement.offset;
}

/* ------------------------------------------------------------------ */
/* Thang                                                               */
/* ------------------------------------------------------------------ */

/** Tiền tố tên thang máy mới theo loại. */
const ELEVATOR_KIND_NAME: Record<ElevatorKind, string> = {
  passenger: 'Thang máy',
  priority: 'Thang máy ưu tiên',
  bed: 'Thang máy bệnh nhân',
  service: 'Thang máy dịch vụ',
};

/** Tên mặc định cho thang mới: đếm theo loại thang (thang máy: theo cả loại thang máy). */
export function nextConnectorName(
  building: Building,
  type: ConnectorType,
  elevatorKind?: ElevatorKind,
): string {
  const kind = type === 'elevator' ? (elevatorKind ?? 'passenger') : undefined;
  const label = kind ? ELEVATOR_KIND_NAME[kind] : CONNECTOR_DEFAULTS[type].label;
  const links = new Set(
    building.floors.flatMap((f) =>
      f.connectors
        .filter((c) => c.type === type && (!kind || (c.elevatorKind ?? 'passenger') === kind))
        .map((c) => c.linkId),
    ),
  );
  return `${label} ${links.size + 1}`;
}

export function addConnector(
  floor: Floor,
  type: ConnectorType,
  center: Point,
  opts: { name: string; linkId?: Id; elevatorKind?: ElevatorKind },
): Connector {
  const d = newConnectorSize(type, opts.elevatorKind ?? 'passenger');
  const connector: Connector = {
    id: createId('conn'),
    type,
    name: opts.name,
    polygon: rectPolygon(center, d.width, d.depth),
    linkId: opts.linkId ?? createId('link'),
    direction: 'both',
  };
  if (type === 'elevator' && opts.elevatorKind && opts.elevatorKind !== 'passenger') {
    connector.elevatorKind = opts.elevatorKind;
  }
  floor.connectors.push(connector);
  return connector;
}

export function connectorRect(c: Connector): { center: Point; width: number; depth: number } {
  const b = boundsOf(c.polygon)!;
  return {
    center: polygonCentroid(c.polygon),
    width: b.maxX - b.minX,
    depth: b.maxY - b.minY,
  };
}

export function setConnectorSize(c: Connector, width: number, depth: number) {
  c.polygon = rectPolygon(connectorRect(c).center, Math.max(width, 0.3), Math.max(depth, 0.3));
}

/**
 * Tạo bản sao thang ở các tầng khác với cùng `linkId` (cùng giếng thang).
 * Bỏ qua tầng đã có thang thuộc nhóm này. Trả về số bản sao đã tạo.
 */
export function cloneConnectorToFloors(
  building: Building,
  sourceFloorId: Id,
  connectorId: Id,
  targetFloorIds: readonly Id[],
): number {
  const source = building.floors
    .find((f) => f.id === sourceFloorId)
    ?.connectors.find((c) => c.id === connectorId);
  if (!source) return 0;
  let created = 0;
  for (const floor of building.floors) {
    if (floor.id === sourceFloorId || !targetFloorIds.includes(floor.id)) continue;
    if (floor.connectors.some((c) => c.linkId === source.linkId)) continue;
    floor.connectors.push({
      ...source,
      id: createId('conn'),
      polygon: source.polygon.map((p) => ({ ...p })),
    });
    created++;
  }
  return created;
}

/* ------------------------------------------------------------------ */
/* Xoá / copy / dán                                                    */
/* ------------------------------------------------------------------ */

/** Xoá các nút đồ thị tham chiếu tới đối tượng đã bị xoá (và cạnh nối với chúng). */
function removeNavRefs(floor: Floor, refIds: ReadonlySet<Id>) {
  const removed = new Set(
    floor.navGraph.nodes.filter((n) => n.refId && refIds.has(n.refId)).map((n) => n.id),
  );
  if (!removed.size) return;
  floor.navGraph.nodes = floor.navGraph.nodes.filter((n) => !removed.has(n.id));
  floor.navGraph.edges = floor.navGraph.edges.filter(
    (e) => !removed.has(e.from) && !removed.has(e.to),
  );
}

export function deleteItems(floor: Floor, refs: readonly ItemRef[]) {
  const ids = (type: ItemRef['type']) =>
    new Set(refs.filter((r) => r.type === type).map((r) => r.id));
  const wallIds = ids('wall');
  const openingIds = ids('opening');
  const connectorIds = ids('connector');
  const roomIds = ids('room');
  const nodeIds = ids('navNode');
  const edgeIds = ids('navEdge');
  const landmarkIds = ids('landmark');
  if (floor.landmarks && landmarkIds.size) {
    floor.landmarks = floor.landmarks.filter((l) => !landmarkIds.has(l.id));
  }
  const annotationIds = ids('annotation');
  if (floor.annotations && annotationIds.size) {
    floor.annotations = floor.annotations.filter((a) => !annotationIds.has(a.id));
  }
  const furnitureIds = ids('furniture');
  if (floor.furniture && furnitureIds.size) {
    floor.furniture = floor.furniture.filter((f) => !furnitureIds.has(f.id));
  }
  for (const o of floor.openings) if (wallIds.has(o.wallId)) openingIds.add(o.id);

  floor.walls = floor.walls.filter((w) => !wallIds.has(w.id));
  floor.openings = floor.openings.filter((o) => !openingIds.has(o.id));
  floor.connectors = floor.connectors.filter((c) => !connectorIds.has(c.id));
  floor.rooms = floor.rooms.filter((r) => !roomIds.has(r.id));
  removeNavRefs(floor, new Set([...openingIds, ...connectorIds, ...roomIds]));
  if (nodeIds.size || edgeIds.size) {
    floor.navGraph.nodes = floor.navGraph.nodes.filter((n) => !nodeIds.has(n.id));
    floor.navGraph.edges = floor.navGraph.edges.filter(
      (e) => !edgeIds.has(e.id) && !nodeIds.has(e.from) && !nodeIds.has(e.to),
    );
  }
}

export function copyItems(floor: Floor, refs: readonly ItemRef[]): Clipboard | null {
  const has = (type: ItemRef['type'], id: Id) => refs.some((r) => r.type === type && r.id === id);
  const walls = floor.walls.filter((w) => has('wall', w.id));
  const wallIds = new Set(walls.map((w) => w.id));
  // Ô cửa đi kèm tường được copy (ô cửa lẻ không có tường thì không copy được).
  const openings = floor.openings.filter((o) => wallIds.has(o.wallId));
  const connectors = floor.connectors.filter((c) => has('connector', c.id));
  const rooms = floor.rooms.filter((r) => has('room', r.id));
  const landmarks = (floor.landmarks ?? []).filter((l) => has('landmark', l.id));
  const annotations = (floor.annotations ?? []).filter((a) => has('annotation', a.id));
  const furniture = (floor.furniture ?? []).filter((f) => has('furniture', f.id));
  const lists = [walls, connectors, rooms, landmarks, annotations, furniture];
  if (!lists.some((list) => list.length)) return null;
  return {
    sourceFloorId: floor.id,
    walls: walls.map(deepClone),
    openings: openings.map(deepClone),
    connectors: connectors.map(deepClone),
    rooms: rooms.map(deepClone),
    landmarks: landmarks.map(deepClone),
    annotations: annotations.map(deepClone),
    furniture: furniture.map(deepClone),
  };
}

/**
 * Dán nội dung clipboard vào `floor`, dịch đi `offset`. Trả về các đối tượng mới (để chọn).
 * Thang dán sang tầng KHÁC giữ nguyên `linkId` → tự nối với thang gốc (cùng giếng thang).
 */
export function pasteItems(floor: Floor, clip: Clipboard, offset: Point): ItemRef[] {
  const created: ItemRef[] = [];
  const wallIdMap = new Map<Id, Id>();
  for (const w of clip.walls) {
    const id = createId('wall');
    wallIdMap.set(w.id, id);
    floor.walls.push({
      ...deepClone(w),
      id,
      start: add(w.start, offset),
      end: add(w.end, offset),
    });
    created.push({ type: 'wall', id });
  }
  for (const o of clip.openings) {
    const wallId = wallIdMap.get(o.wallId);
    if (!wallId) continue;
    floor.openings.push({
      ...deepClone(o),
      id: createId(o.type === 'window' ? 'win' : 'door'),
      wallId,
    });
  }
  const sameFloor = clip.sourceFloorId === floor.id;
  for (const c of clip.connectors) {
    const id = createId('conn');
    floor.connectors.push({
      ...deepClone(c),
      id,
      linkId: sameFloor ? createId('link') : c.linkId,
      polygon: c.polygon.map((p) => add(p, offset)),
    });
    created.push({ type: 'connector', id });
  }
  for (const r of clip.rooms) {
    const id = createId('room');
    floor.rooms.push({
      ...deepClone(r),
      id,
      polygon: r.polygon.map((p) => add(p, offset)),
      destination: r.destination && add(r.destination, offset),
    });
    created.push({ type: 'room', id });
  }
  for (const l of clip.landmarks ?? []) {
    const id = createId('lm');
    (floor.landmarks ??= []).push({ ...deepClone(l), id, position: add(l.position, offset) });
    created.push({ type: 'landmark', id });
  }
  for (const a of clip.annotations ?? []) {
    const id = createId('note');
    (floor.annotations ??= []).push({ ...transformAnnotation(a, (p) => add(p, offset)), id });
    created.push({ type: 'annotation', id });
  }
  for (const f of clip.furniture ?? []) {
    const id = createId('furn');
    (floor.furniture ??= []).push({ ...deepClone(f), id, position: add(f.position, offset) });
    created.push({ type: 'furniture', id });
  }
  return created;
}

/* ------------------------------------------------------------------ */
/* Mốc & điểm đích đến                                                 */
/* ------------------------------------------------------------------ */

/** Tên mặc định cho mốc mới: tên loại, đánh số nếu trùng loại (vd. "ATM 2"). */
export function nextLandmarkName(building: Building, kind: LandmarkKind, label: string): string {
  const count = building.floors.reduce(
    (n, f) => n + (f.landmarks ?? []).filter((l) => l.kind === kind).length,
    0,
  );
  return count === 0 ? label : `${label} ${count + 1}`;
}

export function addLandmark(
  floor: Floor,
  position: Point,
  opts: { name: string; kind: LandmarkKind },
): Landmark {
  const landmark: Landmark = {
    id: createId('lm'),
    name: opts.name,
    kind: opts.kind,
    position: { ...position },
    tags: [],
  };
  (floor.landmarks ??= []).push(landmark);
  return landmark;
}

/**
 * Đặt (hoặc bỏ, khi `p` undefined) điểm đích đến của phòng. Chỉ nhận điểm nằm trong phòng;
 * trả về false nếu bị từ chối.
 */
export function setRoomDestination(floor: Floor, roomId: Id, p: Point | undefined): boolean {
  const room = floor.rooms.find((r) => r.id === roomId);
  if (!room) return false;
  if (p && !pointInPolygon(p, room.polygon)) return false;
  if (p) room.destination = { ...p };
  else delete room.destination;
  return true;
}

/* ------------------------------------------------------------------ */
/* Ghi chú bản vẽ (kích thước, chữ)                                    */
/* ------------------------------------------------------------------ */

/** Nội dung và chiều cao chữ (m) mặc định của chú thích mới. */
export const DEFAULT_NOTE_TEXT = 'Ghi chú';
export const DEFAULT_TEXT_SIZE = 0.6;

/** Đường kích thước đã dời `offset`: hai đầu `a`, `b`, pháp tuyến trái và chiều dài đo được. */
export function dimensionLine(d: Pick<DimensionAnnotation, 'start' | 'end' | 'offset'>) {
  const length = distance(d.start, d.end);
  const dir = length > 1e-9 ? scale(sub(d.end, d.start), 1 / length) : { x: 1, y: 0 };
  const normal = { x: -dir.y, y: dir.x };
  const shift = scale(normal, d.offset);
  return { a: add(d.start, shift), b: add(d.end, shift), normal, length };
}

/** Khoảng dời (có dấu) để đường kích thước của đoạn `start`-`end` đi qua điểm `p`. */
export const dimensionOffsetAt = (start: Point, end: Point, p: Point) =>
  dot(sub(p, start), dimensionLine({ start, end, offset: 0 }).normal);

export function addDimension(
  floor: Floor,
  start: Point,
  end: Point,
  offset: number,
): DimensionAnnotation | null {
  if (distance(start, end) < MIN_WALL_LENGTH) return null;
  const dim: DimensionAnnotation = {
    id: createId('note'),
    kind: 'dimension',
    start: { ...start },
    end: { ...end },
    offset,
  };
  (floor.annotations ??= []).push(dim);
  return dim;
}

export function addText(
  floor: Floor,
  position: Point,
  text = DEFAULT_NOTE_TEXT,
  size = DEFAULT_TEXT_SIZE,
): TextAnnotation {
  const note: TextAnnotation = {
    id: createId('note'),
    kind: 'text',
    position: { ...position },
    text,
    size,
  };
  (floor.annotations ??= []).push(note);
  return note;
}

/** Kích thước khối chữ (m), ước lượng theo số ký tự — dùng chung khi vẽ và khi chọn. */
export function textBox(t: Pick<TextAnnotation, 'text' | 'size'>) {
  const lines = t.text.split('\n');
  const longest = Math.max(1, ...lines.map((l) => l.length));
  return { width: longest * t.size * 0.6, height: lines.length * t.size * 1.2 };
}

/** Góc đọc được: đưa về (-90°, 90°] để chữ không bị lộn ngược. */
export function uprightAngle(deg: number): number {
  let a = ((deg % 360) + 360) % 360;
  if (a > 180) a -= 360;
  if (a > 90) a -= 180;
  else if (a <= -90) a += 180;
  return Math.round(a * 1e6) / 1e6;
}

/**
 * Các điểm đặc trưng của ghi chú. Kích thước: 2 điểm đo rồi 2 đầu đường kích thước; chữ: 4 góc
 * khối chữ (theo góc xoay).
 */
export function annotationPoints(a: Annotation): Point[] {
  if (a.kind === 'dimension') {
    const line = dimensionLine(a);
    return [a.start, a.end, line.a, line.b];
  }
  const { width, height } = textBox(a);
  return rectPolygon(a.position, width, height).map((p) =>
    rotatePoint(p, a.position, a.rotation ?? 0),
  );
}

/**
 * Áp phép biến đổi điểm `fn` lên ghi chú. Đường kích thước giữ đúng phía (kể cả khi lật); chữ
 * xoay theo nhưng luôn đọc được (không lộn ngược, không bị lật gương).
 */
export function transformAnnotation(a: Annotation, fn: (p: Point) => Point): Annotation {
  if (a.kind === 'dimension') {
    const start = fn(a.start);
    const end = fn(a.end);
    return { ...a, start, end, offset: dimensionOffsetAt(start, end, fn(dimensionLine(a).a)) };
  }
  const r = toRadians(a.rotation ?? 0);
  const position = fn(a.position);
  const tip = fn(add(a.position, { x: Math.cos(r), y: Math.sin(r) }));
  const rotation = uprightAngle(toDegrees(angleOf(sub(tip, position))));
  const next: TextAnnotation = { ...a, position };
  if (rotation) next.rotation = rotation;
  else delete next.rotation;
  return next;
}

/* ------------------------------------------------------------------ */
/* Nội thất & thiết bị                                                 */
/* ------------------------------------------------------------------ */

export function addFurniture(
  floor: Floor,
  kind: FurnitureKind,
  position: Point,
  rotation = 0,
): Furniture {
  const def = FURNITURE[kind];
  const item: Furniture = {
    id: createId('furn'),
    kind,
    position: { ...position },
    width: def.width,
    depth: def.depth,
  };
  if (rotation) item.rotation = normalizeAngle(rotation);
  (floor.furniture ??= []).push(item);
  return item;
}

/** Bốn góc ký hiệu (theo góc xoay). */
export const furnitureCorners = (f: Furniture): Point[] => furniturePolygon(f);

/** Áp phép biến đổi `fn` lên ký hiệu: tâm dời theo, góc xoay theo hướng trục ngang. */
export function transformFurniture(f: Furniture, fn: (p: Point) => Point): Furniture {
  const r = toRadians(f.rotation ?? 0);
  const position = fn(f.position);
  const tip = fn(add(f.position, { x: Math.cos(r), y: Math.sin(r) }));
  const rotation = normalizeAngle(toDegrees(angleOf(sub(tip, position))));
  const next: Furniture = { ...f, position };
  if (rotation) next.rotation = rotation;
  else delete next.rotation;
  return next;
}

/* ------------------------------------------------------------------ */
/* Viền vùng chọn (dùng cho cảnh 3D)                                   */
/* ------------------------------------------------------------------ */

export interface Outline {
  points: Point[];
  closed: boolean;
}

/** Ô vuông cạnh `size` quanh điểm `p` — viền cho đối tượng dạng điểm. */
const squareAt = (p: Point, size: number): Outline => ({
  points: rectPolygon(p, size, size),
  closed: true,
});

/** Viền mặt bằng của các đối tượng được chọn (tường theo độ dày, ô cửa theo đoạn trên tường…). */
export function selectionOutlines(floor: Floor, refs: readonly ItemRef[]): Outline[] {
  const node = (id: Id) => floor.navGraph.nodes.find((n) => n.id === id);
  return refs.flatMap((r): Outline[] => {
    switch (r.type) {
      case 'wall': {
        const w = floor.walls.find((x) => x.id === r.id);
        if (!w) return [];
        const seg = { from: 0, to: wallLength(w), start: w.start, end: w.end };
        return [{ points: segmentQuad(w, seg), closed: true }];
      }
      case 'opening': {
        const o = floor.openings.find((x) => x.id === r.id);
        const w = o && floor.walls.find((x) => x.id === o.wallId);
        if (!o || !w) return [];
        const a = pointOnWall(w, o.offset - o.width / 2);
        const b = pointOnWall(w, o.offset + o.width / 2);
        return [{ points: [a, b], closed: false }];
      }
      case 'room':
      case 'connector': {
        const list: readonly { id: Id; polygon: Point[] }[] =
          r.type === 'room' ? floor.rooms : floor.connectors;
        const shape = list.find((x) => x.id === r.id);
        return shape ? [{ points: shape.polygon, closed: true }] : [];
      }
      case 'landmark': {
        const l = floor.landmarks?.find((x) => x.id === r.id);
        return l ? [squareAt(l.position, 0.8)] : [];
      }
      case 'annotation': {
        const a = floor.annotations?.find((x) => x.id === r.id);
        if (!a) return [];
        const pts = annotationPoints(a);
        return [
          a.kind === 'text'
            ? { points: pts, closed: true }
            : { points: pts.slice(2), closed: false },
        ];
      }
      case 'furniture': {
        const f = floor.furniture?.find((x) => x.id === r.id);
        return f ? [{ points: furnitureCorners(f), closed: true }] : [];
      }
      case 'navNode': {
        const n = node(r.id);
        return n ? [squareAt(n.position, 0.5)] : [];
      }
      case 'navEdge': {
        const e = floor.navGraph.edges.find((x) => x.id === r.id);
        const a = e && node(e.from);
        const b = e && node(e.to);
        return a && b ? [{ points: [a.position, b.position], closed: false }] : [];
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* Lớp                                                                 */
/* ------------------------------------------------------------------ */

/** Bản sao `floor` không có các lớp `layers` (lớp tường kéo theo ô cửa). */
export function withoutLayers(floor: Floor, layers: readonly LayerId[]): Floor {
  if (!layers.length) return floor;
  const off = new Set(layers);
  return {
    ...floor,
    ...(off.has('walls') && { walls: [], openings: [] }),
    ...(off.has('rooms') && { rooms: [] }),
    ...(off.has('connectors') && { connectors: [] }),
    ...(off.has('landmarks') && { landmarks: [] }),
    ...(off.has('annotations') && { annotations: [] }),
    ...(off.has('furniture') && { furniture: [] }),
  };
}

/* ------------------------------------------------------------------ */
/* Tầng                                                                */
/* ------------------------------------------------------------------ */

const DEFAULT_FLOOR_HEIGHT = 3.6;

export function floorNameForLevel(level: number): string {
  if (level === 0) return 'Tầng trệt';
  return level < 0 ? `Tầng hầm ${-level}` : `Tầng ${level}`;
}

/**
 * Thêm tầng mới ở trên tầng cao nhất (hoặc dưới tầng thấp nhất nếu `below`).
 * `copyStructureFrom`: sao chép tường, cửa và thang (giữ linkId → thang tự nối giữa 2 tầng).
 */
export function addFloor(
  building: Building,
  opts: { below?: boolean; copyStructureFrom?: Id } = {},
): Floor {
  const sorted = [...building.floors].sort((a, b) => a.level - b.level);
  const top = sorted[sorted.length - 1];
  const bottom = sorted[0];
  const height = top?.height ?? DEFAULT_FLOOR_HEIGHT;
  let level: number;
  let elevation: number;
  if (!top || !bottom) {
    level = 1;
    elevation = 0;
  } else if (opts.below) {
    level = bottom.level - 1;
    elevation = bottom.elevation - height;
  } else {
    level = top.level + 1;
    elevation = top.elevation + top.height;
  }

  const floor: Floor = {
    id: createId('floor'),
    name: floorNameForLevel(level),
    level,
    elevation,
    height,
    walls: [],
    openings: [],
    connectors: [],
    rooms: [],
    navGraph: { nodes: [], edges: [] },
  };

  const source = opts.copyStructureFrom
    ? building.floors.find((f) => f.id === opts.copyStructureFrom)
    : undefined;
  if (source) {
    const wallIdMap = new Map<Id, Id>();
    for (const w of source.walls) {
      const id = createId('wall');
      wallIdMap.set(w.id, id);
      floor.walls.push({ ...deepClone(w), id });
    }
    for (const o of source.openings) {
      const wallId = wallIdMap.get(o.wallId);
      // Cửa chính thường chỉ có ở tầng trệt — đổi thành cửa sổ ở tầng mới.
      if (wallId) {
        floor.openings.push({
          ...deepClone(o),
          ...(o.type === 'entrance'
            ? { type: 'window' as const, ...OPENING_DEFAULTS.window, width: o.width }
            : {}),
          id: createId(o.type === 'door' ? 'door' : 'win'),
          wallId,
        });
      }
    }
    for (const c of source.connectors) {
      floor.connectors.push({ ...deepClone(c), id: createId('conn') });
    }
  }

  building.floors.push(floor);
  return floor;
}

export function removeFloor(building: Building, floorId: Id) {
  building.floors = building.floors.filter((f) => f.id !== floorId);
}

/** Tầng làm mốc cao độ của toà: tầng thấp nhất không phải tầng hầm (thường là tầng trệt / tầng 1). */
const baseFloor = (sorted: readonly Floor[]) => sorted.find((f) => f.level >= 0) ?? sorted[0];

/** Cao độ sàn tầng mốc và tổng chiều cao toà (từ sàn tầng thấp nhất tới mái). */
export function buildingHeights(building: Pick<Building, 'floors'>): {
  baseElevation: number;
  total: number;
  /** Chiều cao tầng chung nếu mọi tầng cao bằng nhau, null nếu khác nhau. */
  floorHeight: number | null;
} {
  const sorted = [...building.floors].sort((a, b) => a.level - b.level);
  if (!sorted.length) return { baseElevation: 0, total: 0, floorHeight: null };
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const same = sorted.every((f) => Math.abs(f.height - first.height) < 1e-6);
  return {
    baseElevation: baseFloor(sorted)!.elevation,
    total: last.elevation + last.height - first.elevation,
    floorHeight: same ? first.height : null,
  };
}

/**
 * Đổi chiều cao tầng (cho mọi tầng) và / hoặc cao độ sàn tầng mốc, rồi xếp lại cao độ các tầng
 * liền nhau: tầng trên đặt lên mái tầng dưới, tầng hầm treo dưới sàn tầng mốc.
 */
export function restackFloors(
  building: Building,
  opts: { floorHeight?: number; baseElevation?: number },
) {
  const sorted = [...building.floors].sort((a, b) => a.level - b.level);
  const base = baseFloor(sorted);
  if (!base) return;
  if (opts.floorHeight !== undefined) for (const f of sorted) f.height = opts.floorHeight;
  if (opts.baseElevation !== undefined) base.elevation = opts.baseElevation;
  const i = sorted.indexOf(base);
  for (let k = i + 1; k < sorted.length; k++) {
    const below = sorted[k - 1]!;
    sorted[k]!.elevation = below.elevation + below.height;
  }
  for (let k = i - 1; k >= 0; k--) {
    const f = sorted[k]!;
    f.elevation = sorted[k + 1]!.elevation - f.height;
  }
}

/**
 * Xoá sạch nội dung vẽ của mọi tầng (tường, cửa, thang, phòng, mốc, đồ thị đi lại) — giữ lại các
 * tầng và ảnh nền để vẽ lại.
 */
export function clearBuilding(building: Building) {
  for (const f of building.floors) {
    f.walls = [];
    f.openings = [];
    f.connectors = [];
    f.rooms = [];
    f.landmarks = [];
    f.annotations = [];
    f.furniture = [];
    f.navGraph = { nodes: [], edges: [] };
  }
}

/* ------------------------------------------------------------------ */
/* Ảnh nền                                                             */
/* ------------------------------------------------------------------ */

/**
 * Hiệu chỉnh tỉ lệ ảnh nền: đoạn `p1`-`p2` (đo trên ảnh hiện tại) thực tế dài `realDistance` m.
 * Ảnh được phóng quanh `p1`, nên `p1` giữ nguyên vị trí.
 */
export function calibrateBackground(
  bg: FloorBackground,
  p1: Point,
  p2: Point,
  realDistance: number,
): FloorBackground {
  const measured = distance(p1, p2);
  if (measured < 1e-6 || realDistance <= 0) return bg;
  const k = realDistance / measured;
  const rel = sub(bg.offset, p1);
  return {
    ...bg,
    metersPerPixel: bg.metersPerPixel * k,
    offset: { x: p1.x + rel.x * k, y: p1.y + rel.y * k },
  };
}
