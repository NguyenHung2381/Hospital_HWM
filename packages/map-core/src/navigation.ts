import {
  distance,
  pointInPolygon,
  pointsEqual,
  polylineLength,
  projectPointOnSegment,
  segmentIntersection,
  signedAngleBetween,
  sub,
  toDegrees,
} from './geometry';
import { findFloor, findLandmark, findRoom, roomDestination } from './lookup';
import type {
  Building,
  Connector,
  ConnectorType,
  Floor,
  Id,
  Location,
  NavNode,
  Point,
  Room,
  Route,
  RouteEntry,
  RouteInstruction,
  RouteSegment,
} from './types';

/** Tốc độ đi bộ trung bình (m/s). */
export const WALK_SPEED = 1.2;

/** Góc lệch tối thiểu (độ) để coi là một lần rẽ. */
const TURN_THRESHOLD_DEG = 30;

/** Chặng ngắn hơn giá trị này được gộp vào chặng sau, không tạo bước "đi thẳng / rẽ" riêng. */
const MIN_LEG_METERS = 1.5;

/** Thời gian (giây) để đi qua một phương tiện chuyển tầng với chênh lệch cao độ `dz` (m). */
export function connectorTravelSeconds(type: ConnectorType, dz: number): number {
  const h = Math.abs(dz);
  switch (type) {
    case 'elevator':
      return 30 + h * 1.5; // chờ thang + di chuyển
    case 'stairs':
      return h * 6;
    case 'escalator':
      return h * 5;
  }
}

export interface RouteOptions {
  /** Chỉ dùng lối đi phù hợp xe lăn: bỏ thang bộ, thang cuốn và các cạnh `accessible: false`. */
  accessibleOnly?: boolean;
}

export type RouteTarget = { roomId: Id } | { landmarkId: Id } | Location;

export class RouteError extends Error {
  constructor(
    public readonly code:
      'UNKNOWN_FLOOR' | 'UNKNOWN_ROOM' | 'UNKNOWN_LANDMARK' | 'EMPTY_GRAPH' | 'ROOM_NOT_IN_GRAPH',
    message: string,
  ) {
    super(message);
    this.name = 'RouteError';
  }
}

/* ------------------------------------------------------------------ */
/* Đồ thị toàn toà nhà                                                 */
/* ------------------------------------------------------------------ */

/** Khoá toàn cục của một nút: `floorId:nodeId` (ID nút chỉ duy nhất trong một tầng). */
type Key = string;
const keyOf = (floorId: Id, nodeId: Id): Key => `${floorId}:${nodeId}`;

interface GraphNode {
  key: Key;
  floorId: Id;
  position: Point;
  node?: NavNode;
}

interface Arc {
  to: Key;
  /** Chi phí quy đổi ra "mét đi bộ" để so sánh được với quãng đường. */
  cost: number;
  connector?: Connector;
}

interface Graph {
  nodes: Map<Key, GraphNode>;
  adj: Map<Key, Arc[]>;
}

function addArc(g: Graph, from: Key, arc: Arc) {
  const list = g.adj.get(from);
  if (list) list.push(arc);
  else g.adj.set(from, [arc]);
}

function canTravel(connector: Connector, fromElevation: number, toElevation: number): boolean {
  if (connector.direction === 'both') return true;
  return connector.direction === 'up' ? toElevation > fromElevation : toElevation < fromElevation;
}

export function buildBuildingGraph(building: Building, options: RouteOptions = {}): Graph {
  const g: Graph = { nodes: new Map(), adj: new Map() };

  for (const floor of building.floors) {
    for (const node of floor.navGraph.nodes) {
      const key = keyOf(floor.id, node.id);
      g.nodes.set(key, { key, floorId: floor.id, position: node.position, node });
    }
    for (const edge of floor.navGraph.edges) {
      if (options.accessibleOnly && edge.accessible === false) continue;
      const a = g.nodes.get(keyOf(floor.id, edge.from));
      const b = g.nodes.get(keyOf(floor.id, edge.to));
      if (!a || !b) continue;
      const cost = edge.weight ?? distance(a.position, b.position);
      addArc(g, a.key, { to: b.key, cost });
      addArc(g, b.key, { to: a.key, cost });
    }
  }

  // Nối các nút thang có cùng linkId giữa các tầng.
  const byLink = new Map<Id, { floor: Floor; connector: Connector; key: Key }[]>();
  for (const floor of building.floors) {
    const connectors = new Map(floor.connectors.map((c) => [c.id, c]));
    for (const node of floor.navGraph.nodes) {
      if (node.kind !== 'connector' || !node.refId) continue;
      const connector = connectors.get(node.refId);
      if (!connector) continue;
      if (options.accessibleOnly && connector.type !== 'elevator') continue;
      const list = byLink.get(connector.linkId) ?? [];
      list.push({ floor, connector, key: keyOf(floor.id, node.id) });
      byLink.set(connector.linkId, list);
    }
  }
  for (const list of byLink.values()) {
    for (const a of list) {
      for (const b of list) {
        if (a.floor.id === b.floor.id) continue;
        if (!canTravel(a.connector, a.floor.elevation, b.floor.elevation)) continue;
        const seconds = connectorTravelSeconds(
          a.connector.type,
          b.floor.elevation - a.floor.elevation,
        );
        addArc(g, a.key, { to: b.key, cost: seconds * WALK_SPEED, connector: a.connector });
      }
    }
  }

  return g;
}

/* ------------------------------------------------------------------ */
/* Gắn vị trí tự do vào đồ thị                                          */
/* ------------------------------------------------------------------ */

/**
 * Chiếu `location` lên cạnh gần nhất của tầng và thêm một nút tạm vào đồ thị.
 * Trả về khoá nút tạm.
 */
function attachLocation(g: Graph, floor: Floor, location: Location, tag: string): Key {
  const key = `${floor.id}:__${tag}`;
  g.nodes.set(key, { key, floorId: floor.id, position: location.position });

  let best: { a: Key; b: Key; point: Point; distance: number } | null = null;
  for (const edge of floor.navGraph.edges) {
    const a = g.nodes.get(keyOf(floor.id, edge.from));
    const b = g.nodes.get(keyOf(floor.id, edge.to));
    if (!a || !b || !g.adj.get(a.key)?.some((arc) => arc.to === b.key)) continue;
    const proj = projectPointOnSegment(location.position, a.position, b.position);
    if (!best || proj.distance < best.distance) {
      best = { a: a.key, b: b.key, point: proj.point, distance: proj.distance };
    }
  }

  if (best) {
    // Nút tạm trên cạnh, rồi nối vị trí thật vào nút đó.
    const onEdgeKey = `${key}_proj`;
    g.nodes.set(onEdgeKey, { key: onEdgeKey, floorId: floor.id, position: best.point });
    const link = (u: Key, v: Key) => {
      const cost = distance(g.nodes.get(u)!.position, g.nodes.get(v)!.position);
      addArc(g, u, { to: v, cost });
      addArc(g, v, { to: u, cost });
    };
    link(key, onEdgeKey);
    link(onEdgeKey, best.a);
    link(onEdgeKey, best.b);
    return key;
  }

  // Tầng không có cạnh nào: nối tới nút gần nhất.
  let nearest: GraphNode | null = null;
  for (const n of g.nodes.values()) {
    if (n.floorId !== floor.id || n.key === key) continue;
    if (
      !nearest ||
      distance(n.position, location.position) < distance(nearest.position, location.position)
    ) {
      nearest = n;
    }
  }
  if (!nearest) throw new RouteError('EMPTY_GRAPH', `Tầng "${floor.name}" chưa có đồ thị đi lại`);
  const cost = distance(nearest.position, location.position);
  addArc(g, key, { to: nearest.key, cost });
  addArc(g, nearest.key, { to: key, cost });
  return key;
}

/* ------------------------------------------------------------------ */
/* Dijkstra                                                            */
/* ------------------------------------------------------------------ */

class MinHeap<T> {
  private items: { priority: number; value: T }[] = [];
  get size() {
    return this.items.length;
  }
  push(value: T, priority: number) {
    const items = this.items;
    items.push({ priority, value });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent]!.priority <= items[i]!.priority) break;
      [items[parent], items[i]] = [items[i]!, items[parent]!];
      i = parent;
    }
  }
  pop(): { priority: number; value: T } | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0 && last) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && items[l]!.priority < items[m]!.priority) m = l;
        if (r < items.length && items[r]!.priority < items[m]!.priority) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i]!, items[m]!];
        i = m;
      }
    }
    return top;
  }
}

interface PathStep {
  key: Key;
  /** Cung dùng để đi tới nút này (undefined với nút đầu). */
  via?: Arc;
}

function dijkstra(g: Graph, start: Key, goals: ReadonlySet<Key>): PathStep[] | null {
  const dist = new Map<Key, number>([[start, 0]]);
  const prev = new Map<Key, { from: Key; arc: Arc }>();
  const heap = new MinHeap<Key>();
  heap.push(start, 0);

  while (heap.size) {
    const { priority, value: u } = heap.pop()!;
    if (priority > (dist.get(u) ?? Infinity)) continue;
    if (goals.has(u)) {
      const path: PathStep[] = [];
      let cur: Key | undefined = u;
      while (cur !== undefined) {
        const p = prev.get(cur);
        path.push({ key: cur, via: p?.arc });
        cur = p?.from;
      }
      return path.reverse();
    }
    for (const arc of g.adj.get(u) ?? []) {
      const nd = priority + arc.cost;
      if (nd < (dist.get(arc.to) ?? Infinity)) {
        dist.set(arc.to, nd);
        prev.set(arc.to, { from: u, arc });
        heap.push(arc.to, nd);
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Dựng kết quả                                                         */
/* ------------------------------------------------------------------ */

/** Bỏ các điểm trùng nhau và điểm nằm thẳng hàng. */
function simplifyPath(points: Point[]): Point[] {
  const dedup = points.filter((p, i) => i === 0 || !pointsEqual(p, points[i - 1]!));
  if (dedup.length < 3) return dedup;
  const out: Point[] = [dedup[0]!];
  for (let i = 1; i < dedup.length - 1; i++) {
    const a = sub(dedup[i]!, out[out.length - 1]!);
    const b = sub(dedup[i + 1]!, dedup[i]!);
    if (Math.abs(toDegrees(signedAngleBetween(a, b))) > 1) out.push(dedup[i]!);
  }
  out.push(dedup[dedup.length - 1]!);
  return out;
}

const CONNECTOR_VERB: Record<ConnectorType, { type: RouteInstruction['type']; label: string }> = {
  elevator: { type: 'take-elevator', label: 'Đi thang máy' },
  stairs: { type: 'take-stairs', label: 'Đi thang bộ' },
  escalator: { type: 'take-escalator', label: 'Đi thang cuốn' },
};

const fmtMeters = (m: number) => `${Math.max(1, Math.round(m))} m`;

function walkInstructions(path: Point[], floorId: Id): RouteInstruction[] {
  const out: RouteInstruction[] = [];
  let run = 0;
  for (let i = 1; i < path.length; i++) {
    run += distance(path[i - 1]!, path[i]!);
    const next = path[i + 1];
    if (!next) break;
    const angle = toDegrees(signedAngleBetween(sub(path[i]!, path[i - 1]!), sub(next, path[i]!)));
    if (Math.abs(angle) < TURN_THRESHOLD_DEG) continue;
    // Chặng quá ngắn (vd. từ chỗ người dùng đứng ra tới hành lang): bỏ qua cả chặng lẫn lần rẽ
    // ngay sau nó — người dùng chưa biết mình đang quay mặt hướng nào nên "rẽ phải" vô nghĩa.
    if (run < MIN_LEG_METERS) continue;
    out.push({ type: 'straight', text: `Đi thẳng ${fmtMeters(run)}`, floorId, distance: run });
    // Trục y hướng xuống nên góc dương = rẽ phải.
    const right = angle > 0;
    out.push({
      type: right ? 'turn-right' : 'turn-left',
      text: right ? 'Rẽ phải' : 'Rẽ trái',
      floorId,
      distance: 0,
    });
    run = 0;
  }
  if (run > 0.5) {
    out.push({ type: 'straight', text: `Đi thẳng ${fmtMeters(run)}`, floorId, distance: run });
  }
  return out;
}

/** Đoạn đi tới cửa ngắn hơn chừng này (m) được gộp vào bước "Vào cửa phòng". */
const DOOR_MERGE_METERS = 3;

/** Quãng đường (m) từ đầu polyline tới hình chiếu của `p` lên polyline. */
function distanceAlong(path: readonly Point[], p: Point): number {
  let best = { d: Infinity, along: 0 };
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const proj = projectPointOnSegment(p, a, b);
    if (proj.distance < best.d) best = { d: proj.distance, along: acc + distance(a, proj.point) };
    acc += distance(a, b);
  }
  return best.along;
}

/**
 * Chèn bước "Vào cửa phòng" vào chặng đi thẳng chứa cửa. Đoạn trước cửa quá ngắn thì gộp vào
 * bước vào cửa (bước có `distance` = số mét đi tới cửa).
 */
function withEntryStep(
  walk: RouteInstruction[],
  path: readonly Point[],
  entry: RouteEntry,
  room: Room,
): RouteInstruction[] {
  const doorAt = distanceAlong(path, entry.position);
  const enter = (meters: number): RouteInstruction => ({
    type: 'enter-room',
    text: `Vào cửa phòng ${room.code ? `${room.name} (${room.code})` : room.name}`,
    floorId: entry.floorId,
    distance: meters,
  });
  const out: RouteInstruction[] = [];
  let acc = 0;
  let inserted = false;
  for (const ins of walk) {
    if (inserted || ins.type !== 'straight' || acc + ins.distance < doorAt - 1e-6) {
      acc += ins.distance;
      out.push(ins);
      continue;
    }
    const before = Math.max(0, doorAt - acc);
    const after = acc + ins.distance - doorAt;
    if (before >= DOOR_MERGE_METERS) {
      out.push({ ...ins, text: `Đi thẳng ${fmtMeters(before)}`, distance: before }, enter(0));
    } else {
      out.push(enter(before));
    }
    if (after > 0.5) {
      out.push({ ...ins, text: `Đi thẳng ${fmtMeters(after)}`, distance: after });
    }
    acc += ins.distance;
    inserted = true;
  }
  // Không có chặng đi thẳng nào chứa cửa (vd. cửa ở ngay điểm cuối): thêm ở cuối.
  if (!inserted) out.push(enter(0));
  return out;
}

/**
 * Tìm đường ngắn nhất (theo thời gian) từ `from` tới một phòng hoặc một vị trí.
 * Trả về null nếu không có đường đi.
 */
export function findRoute(
  building: Building,
  from: Location,
  target: RouteTarget,
  options: RouteOptions = {},
): Route | null {
  const fromFloor = findFloor(building, from.floorId);
  if (!fromFloor) throw new RouteError('UNKNOWN_FLOOR', `Không tìm thấy tầng "${from.floorId}"`);

  const g = buildBuildingGraph(building, options);
  const startKey = attachLocation(g, fromFloor, from, 'start');

  /** Các nút đồ thị đại diện cho phòng (đi vào phòng qua cửa). */
  const roomGoals = (floor: Floor, room: { id: Id; name: string }) => {
    const nodes = floor.navGraph.nodes.filter((n) => n.kind === 'room' && n.refId === room.id);
    if (!nodes.length) {
      throw new RouteError('ROOM_NOT_IN_GRAPH', `Phòng "${room.name}" chưa có trong đồ thị đi lại`);
    }
    return new Set(nodes.map((n) => keyOf(floor.id, n.id)));
  };

  let goals: Set<Key>;
  let to: Route['to'];
  let destinationName: string;
  /** Điểm cuối cùng nối thêm sau nút đích (điểm đích trong phòng, mốc trong phòng). */
  let finalPoint: Point | undefined;
  /** Phòng mà tuyến đi vào ở cuối — để đánh dấu cửa vào. */
  let entryRoom: Room | undefined;
  if ('roomId' in target) {
    const ref = findRoom(building, target.roomId);
    if (!ref) throw new RouteError('UNKNOWN_ROOM', `Không tìm thấy phòng "${target.roomId}"`);
    goals = roomGoals(ref.floor, ref.room);
    finalPoint = roomDestination(ref.room);
    entryRoom = ref.room;
    to = { floorId: ref.floor.id, position: finalPoint ?? { x: 0, y: 0 }, roomId: ref.room.id };
    destinationName = ref.room.code ? `${ref.room.name} (${ref.room.code})` : ref.room.name;
  } else if ('landmarkId' in target) {
    const ref = findLandmark(building, target.landmarkId);
    if (!ref) {
      throw new RouteError('UNKNOWN_LANDMARK', `Không tìm thấy mốc "${target.landmarkId}"`);
    }
    const { floor, landmark } = ref;
    // Mốc nằm trong một phòng: đi vào phòng qua cửa rồi tới mốc (không xuyên tường).
    const room = floor.rooms.find((r) => pointInPolygon(landmark.position, r.polygon));
    goals = room
      ? roomGoals(floor, room)
      : new Set([
          attachLocation(g, floor, { floorId: floor.id, position: landmark.position }, 'goal'),
        ]);
    finalPoint = landmark.position;
    entryRoom = room;
    to = { floorId: floor.id, position: landmark.position, landmarkId: landmark.id };
    destinationName = landmark.name;
  } else {
    const toFloor = findFloor(building, target.floorId);
    if (!toFloor) throw new RouteError('UNKNOWN_FLOOR', `Không tìm thấy tầng "${target.floorId}"`);
    goals = new Set([attachLocation(g, toFloor, target, 'goal')]);
    to = { floorId: toFloor.id, position: target.position };
    destinationName = 'điểm đến';
  }

  const steps = dijkstra(g, startKey, goals);
  if (!steps) return null;
  const goalPosition = g.nodes.get(steps[steps.length - 1]!.key)!.position;
  to = { ...to, position: finalPoint ?? goalPosition };

  // Chia đường đi theo tầng.
  const segments: RouteSegment[] = [];
  let current: RouteSegment | null = null;
  let transitionSeconds = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const node = g.nodes.get(step.key)!;
    const prevNode = i > 0 ? g.nodes.get(steps[i - 1]!.key) : undefined;
    if (current && step.via?.connector && prevNode && prevNode.floorId !== node.floorId) {
      const prevFloor = findFloor(building, prevNode.floorId)!;
      const nextFloor = findFloor(building, node.floorId)!;
      current.transition = {
        connectorId: step.via.connector.id,
        connectorType: step.via.connector.type,
        toFloorId: node.floorId,
      };
      transitionSeconds += connectorTravelSeconds(
        step.via.connector.type,
        nextFloor.elevation - prevFloor.elevation,
      );
      current = null;
    }
    if (!current) {
      current = { floorId: node.floorId, path: [] };
      segments.push(current);
    }
    current.path.push(node.position);
  }
  if (finalPoint) {
    const path = segments[segments.length - 1]!.path;
    const lastFloor = findFloor(building, segments[segments.length - 1]!.floorId)!;
    // Nút phòng (giữa phòng) chỉ là điểm trung gian: từ cửa đi thẳng tới đích nếu không vướng tường.
    const goalNode = g.nodes.get(steps[steps.length - 1]!.key)!.node;
    const beforeGoal = path[path.length - 2];
    if (
      goalNode?.kind === 'room' &&
      beforeGoal &&
      !lastFloor.walls.some((w) => {
        // Cửa nằm ngay trên tường: bỏ qua giao điểm tại chính điểm cửa.
        const hit = segmentIntersection(beforeGoal, finalPoint, w.start, w.end);
        return hit !== null && distance(hit, beforeGoal) > 0.05;
      })
    ) {
      path.pop();
    }
    path.push(finalPoint);
  }
  for (const s of segments) s.path = simplifyPath(s.path);

  // Cửa vào phòng đích: nút cửa cuối cùng trên đường đi (cùng tầng với đích).
  let entry: RouteEntry | undefined;
  if (entryRoom) {
    const lastFloorId = segments[segments.length - 1]!.floorId;
    for (let i = steps.length - 1; i >= 0; i--) {
      const n = g.nodes.get(steps[i]!.key)!;
      if (n.floorId !== lastFloorId) break;
      if (n.node?.kind === 'door' || n.node?.kind === 'entrance') {
        entry = {
          floorId: n.floorId,
          position: n.position,
          openingId: n.node.refId,
          roomId: entryRoom.id,
          label: `Cửa ${entryRoom.code || entryRoom.name}`,
        };
        break;
      }
    }
  }

  const floorName = (id: Id) => findFloor(building, id)?.name ?? id;
  const instructions: RouteInstruction[] = [
    {
      type: 'start',
      text: `Bắt đầu tại vị trí hiện tại (${floorName(from.floorId)})`,
      floorId: from.floorId,
      distance: 0,
    },
  ];
  for (const [i, s] of segments.entries()) {
    const walk = walkInstructions(s.path, s.floorId);
    const isLast = i === segments.length - 1;
    instructions.push(
      ...(isLast && entry && entryRoom ? withEntryStep(walk, s.path, entry, entryRoom) : walk),
    );
    if (s.transition) {
      const verb = CONNECTOR_VERB[s.transition.connectorType];
      const fromLevel = findFloor(building, s.floorId)!.level;
      const toLevel = findFloor(building, s.transition.toFloorId)!.level;
      instructions.push({
        type: verb.type,
        text: `${verb.label} ${toLevel > fromLevel ? 'lên' : 'xuống'} ${floorName(s.transition.toFloorId)}`,
        floorId: s.floorId,
        distance: 0,
      });
    }
  }
  const last = segments[segments.length - 1]!;
  instructions.push({
    type: 'arrive',
    text: `Đến ${destinationName}`,
    floorId: last.floorId,
    distance: 0,
  });

  const walkDistance = segments.reduce((sum, s) => sum + polylineLength(s.path), 0);
  return {
    buildingId: building.id,
    from,
    to,
    distance: walkDistance,
    estimatedSeconds: Math.round(walkDistance / WALK_SPEED + transitionSeconds),
    segments,
    instructions,
    ...(entry ? { entry } : {}),
  };
}
