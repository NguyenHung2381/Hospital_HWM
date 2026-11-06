import {
  distance,
  furnitureAcross,
  pointInPolygon,
  pointsEqual,
  polylineLength,
  projectPointOnSegment,
  signedAngleBetween,
  sub,
  toDegrees,
  type SegmentProjection,
} from './geometry';
import { dijkstra, pathTo, type PathStep, type WeightedArc } from './graph';
import { findLandmark, findRoom, roomDestination } from './lookup';
import { crossesWall, solidWallObstacles, type WallObstacle } from './obstacles';
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
    case 'ramp':
      return h * 10; // dốc ~1:12, đi bộ ~1,2 m/s
  }
}

export interface RouteOptions {
  /** Chỉ dùng lối đi phù hợp xe lăn: bỏ thang bộ, thang cuốn và các cạnh `accessible: false` (giữ thang máy, dốc). */
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

interface Arc extends WeightedArc {
  to: Key;
  /** Chi phí quy đổi ra "mét đi bộ" để so sánh được với quãng đường. */
  cost: number;
  connector?: Connector;
}

/** Một cạnh trong tầng (đã qua bộ lọc `accessibleOnly`) — để gắn vị trí tự do vào giữa cạnh. */
interface GraphEdge {
  a: Key;
  b: Key;
  /** Chi phí trên mỗi mét dọc cạnh (≠ 1 khi cạnh có `weight` riêng). */
  perMeter: number;
}

export interface BuildingGraph {
  nodes: Map<Key, GraphNode>;
  adj: Map<Key, Arc[]>;
  /** Các cạnh trong tầng, theo tầng. */
  edges: Map<Id, GraphEdge[]>;
  /** Các nút, theo tầng. */
  floorNodes: Map<Id, GraphNode[]>;
}

function addArc(adj: Map<Key, Arc[]>, from: Key, arc: Arc) {
  const list = adj.get(from);
  if (list) list.push(arc);
  else adj.set(from, [arc]);
}

/** Chi phí cộng thêm (m) cho cạnh đi xuyên qua nội thất. */
export const FURNITURE_PENALTY = 100;

function canTravel(connector: Connector, fromElevation: number, toElevation: number): boolean {
  if (connector.direction === 'both') return true;
  return connector.direction === 'up' ? toElevation > fromElevation : toElevation < fromElevation;
}

export function buildBuildingGraph(building: Building, options: RouteOptions = {}): BuildingGraph {
  const g: BuildingGraph = {
    nodes: new Map(),
    adj: new Map(),
    edges: new Map(),
    floorNodes: new Map(),
  };

  for (const floor of building.floors) {
    const floorNodes: GraphNode[] = [];
    for (const node of floor.navGraph.nodes) {
      const key = keyOf(floor.id, node.id);
      const gn: GraphNode = { key, floorId: floor.id, position: node.position, node };
      g.nodes.set(key, gn);
      floorNodes.push(gn);
    }
    g.floorNodes.set(floor.id, floorNodes);
    const floorEdges: GraphEdge[] = [];
    for (const edge of floor.navGraph.edges) {
      if (options.accessibleOnly && edge.accessible === false) continue;
      const a = g.nodes.get(keyOf(floor.id, edge.from));
      const b = g.nodes.get(keyOf(floor.id, edge.to));
      if (!a || !b) continue;
      const len = distance(a.position, b.position);
      const weight = edge.weight ?? len;
      // Cạnh xuyên qua nội thất (đồ thị vẽ tay / chưa sinh lại sau khi kê đồ): vẫn đi được nếu
      // không còn lối nào khác, nhưng tuyến sẽ ưu tiên đường vòng.
      const blocked = furnitureAcross(floor.furniture, a.position, b.position);
      const cost = weight + (blocked ? FURNITURE_PENALTY : 0);
      addArc(g.adj, a.key, { to: b.key, cost });
      addArc(g.adj, b.key, { to: a.key, cost });
      floorEdges.push({ a: a.key, b: b.key, perMeter: len > 1e-9 ? weight / len : 1 });
    }
    g.edges.set(floor.id, floorEdges);
  }

  // Nối các nút thang có cùng linkId giữa các tầng.
  const byLink = new Map<Id, { floor: Floor; connector: Connector; key: Key }[]>();
  for (const floor of building.floors) {
    const connectors = new Map(floor.connectors.map((c) => [c.id, c]));
    for (const node of floor.navGraph.nodes) {
      if (node.kind !== 'connector' || !node.refId) continue;
      const connector = connectors.get(node.refId);
      if (!connector) continue;
      if (options.accessibleOnly && connector.type !== 'elevator' && connector.type !== 'ramp')
        continue;
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
        addArc(g.adj, a.key, { to: b.key, cost: seconds * WALK_SPEED, connector: a.connector });
      }
    }
  }

  return g;
}

/* ------------------------------------------------------------------ */
/* Một lần tìm đường: các nút tạm đặt chồng lên đồ thị gốc              */
/* ------------------------------------------------------------------ */

/**
 * Nút tạm (vị trí người dùng, điểm đến tự do…) và cung nối của MỘT lần tìm đường. Đồ thị gốc
 * không bị sửa nên dùng lại được cho nhiều lần tìm.
 */
class RouteQuery {
  private nodes = new Map<Key, GraphNode>();
  private adj = new Map<Key, Arc[]>();
  /** Các nút tạm đã chèn vào giữa từng cạnh — nối thẳng với nhau khi cùng cạnh. */
  private onEdge = new Map<GraphEdge, Key[]>();
  private seq = 0;

  constructor(
    private readonly g: BuildingGraph,
    private readonly wallsOf: (floor: Floor) => readonly WallObstacle[],
  ) {}

  node(key: Key): GraphNode | undefined {
    return this.nodes.get(key) ?? this.g.nodes.get(key);
  }

  readonly neighbors = (key: Key): readonly Arc[] => {
    const base = this.g.adj.get(key);
    const extra = this.adj.get(key);
    if (!extra) return base ?? [];
    return base ? base.concat(extra) : extra;
  };

  private link(u: Key, v: Key, cost: number) {
    addArc(this.adj, u, { to: v, cost });
    addArc(this.adj, v, { to: u, cost });
  }

  /** Nối hai điểm trong tầng bằng đoạn thẳng (bị phạt nếu xuyên qua nội thất). */
  private walk(floor: Floor, u: Key, v: Key, perMeter = 1) {
    const pu = this.node(u)!.position;
    const pv = this.node(v)!.position;
    const blocked = furnitureAcross(floor.furniture, pu, pv);
    this.link(u, v, distance(pu, pv) * perMeter + (blocked ? FURNITURE_PENALTY : 0));
  }

  /** Nút tại hình chiếu `proj` trên cạnh `edge` (dùng luôn đầu cạnh nếu hình chiếu trùng đầu cạnh). */
  private split(floor: Floor, edge: GraphEdge, proj: SegmentProjection): Key {
    const a = this.node(edge.a)!;
    const b = this.node(edge.b)!;
    if (pointsEqual(proj.point, a.position)) return a.key;
    if (pointsEqual(proj.point, b.position)) return b.key;
    const key = `${floor.id}:__p${this.seq++}`;
    this.nodes.set(key, { key, floorId: floor.id, position: proj.point });
    this.walk(floor, key, a.key, edge.perMeter);
    this.walk(floor, key, b.key, edge.perMeter);
    // Hai vị trí cùng chiếu lên một cạnh (vd. điểm đầu và điểm cuối cùng một đoạn hành lang): đi
    // thẳng giữa chúng, không phải vòng ra đầu cạnh rồi quay lại.
    const others = this.onEdge.get(edge) ?? [];
    for (const other of others) this.walk(floor, key, other, edge.perMeter);
    this.onEdge.set(edge, [...others, key]);
    return key;
  }

  /**
   * Thêm nút tạm tại `position` và nối vào cạnh gần nhất của tầng mà đoạn nối KHÔNG xuyên tường
   * (người đứng trong phòng đi ra qua cửa, không xuyên sang hành lang sau tường). Chỉ khi không có
   * cạnh nào nhìn thấy được mới dùng cạnh gần nhất.
   */
  attach(floor: Floor, position: Point, tag: string): Key {
    const key = `${floor.id}:__${tag}`;
    this.nodes.set(key, { key, floorId: floor.id, position });
    const walls = this.wallsOf(floor);
    const visible = (p: Point) => !crossesWall(walls, position, p);

    const edges = this.g.edges.get(floor.id) ?? [];
    if (edges.length) {
      const candidates = edges
        .map((edge) => ({
          edge,
          proj: projectPointOnSegment(
            position,
            this.node(edge.a)!.position,
            this.node(edge.b)!.position,
          ),
        }))
        .sort((p, q) => p.proj.distance - q.proj.distance);
      const best = candidates.find((c) => visible(c.proj.point)) ?? candidates[0]!;
      this.walk(floor, key, this.split(floor, best.edge, best.proj));
      return key;
    }

    // Tầng không có cạnh nào: nối tới nút gần nhất (ưu tiên nút nhìn thấy được).
    const nodes = [...(this.g.floorNodes.get(floor.id) ?? [])].sort(
      (p, q) => distance(p.position, position) - distance(q.position, position),
    );
    const nearest = nodes.find((n) => visible(n.position)) ?? nodes[0];
    if (!nearest) throw new RouteError('EMPTY_GRAPH', `Tầng "${floor.name}" chưa có đồ thị đi lại`);
    this.walk(floor, key, nearest.key);
    return key;
  }
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
  ramp: { type: 'take-ramp', label: 'Đi theo dốc' },
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

/* ------------------------------------------------------------------ */
/* Tìm đường                                                           */
/* ------------------------------------------------------------------ */

/** Điểm đến đã được gắn vào đồ thị của một lần tìm. */
interface Goal {
  keys: ReadonlySet<Key>;
  to: Route['to'];
  destinationName: string;
  /** Điểm cuối cùng nối thêm sau nút đích (điểm đích trong phòng, mốc trong phòng). */
  finalPoint?: Point;
  /** Phòng mà tuyến đi vào ở cuối — để đánh dấu cửa vào. */
  entryRoom?: Room;
}

/**
 * Bộ tìm đường của một toà: dựng đồ thị một lần, dùng lại cho nhiều lần tìm. Đồ thị được chụp
 * tại lúc tạo — toà nhà sửa sau đó (kể cả sửa trực tiếp object) cần tạo bộ tìm đường mới.
 */
export interface BuildingRouter {
  readonly building: Building;
  readonly options: RouteOptions;
  /** Tuyến ngắn nhất (theo thời gian) từ `from` tới `target`, null nếu không có đường. */
  route(from: Location, target: RouteTarget): Route | null;
  /** Như `route` cho nhiều điểm đến cùng lúc (một lần Dijkstra). */
  routes(from: Location, targets: readonly RouteTarget[]): (Route | null)[];
  /** Ném `RouteError` nếu không thể chỉ đường tới `target` (phòng không tồn tại / chưa có trong đồ thị…). */
  assertTarget(target: RouteTarget): void;
}

export function createBuildingRouter(
  building: Building,
  options: RouteOptions = {},
): BuildingRouter {
  const g = buildBuildingGraph(building, options);
  const floors = new Map(building.floors.map((f) => [f.id, f]));
  const walls = new Map<Id, WallObstacle[]>();
  const wallsOf = (floor: Floor) => {
    let list = walls.get(floor.id);
    if (!list) walls.set(floor.id, (list = solidWallObstacles(floor)));
    return list;
  };
  const floorOf = (id: Id) => {
    const floor = floors.get(id);
    if (!floor) throw new RouteError('UNKNOWN_FLOOR', `Không tìm thấy tầng "${id}"`);
    return floor;
  };

  /** Các nút đồ thị đại diện cho phòng (đi vào phòng qua cửa). */
  const roomGoals = (floor: Floor, room: Room): Set<Key> => {
    const nodes = floor.navGraph.nodes.filter((n) => n.kind === 'room' && n.refId === room.id);
    if (!nodes.length) {
      throw new RouteError('ROOM_NOT_IN_GRAPH', `Phòng "${room.name}" chưa có trong đồ thị đi lại`);
    }
    return new Set(nodes.map((n) => keyOf(floor.id, n.id)));
  };

  const resolve = (q: RouteQuery, target: RouteTarget, tag: string): Goal => {
    if ('roomId' in target) {
      const ref = findRoom(building, target.roomId);
      if (!ref) throw new RouteError('UNKNOWN_ROOM', `Không tìm thấy phòng "${target.roomId}"`);
      const finalPoint = roomDestination(ref.room);
      return {
        keys: roomGoals(ref.floor, ref.room),
        finalPoint,
        entryRoom: ref.room,
        to: { floorId: ref.floor.id, position: finalPoint ?? { x: 0, y: 0 }, roomId: ref.room.id },
        destinationName: ref.room.code ? `${ref.room.name} (${ref.room.code})` : ref.room.name,
      };
    }
    if ('landmarkId' in target) {
      const ref = findLandmark(building, target.landmarkId);
      if (!ref) {
        throw new RouteError('UNKNOWN_LANDMARK', `Không tìm thấy mốc "${target.landmarkId}"`);
      }
      const { floor, landmark } = ref;
      // Mốc nằm trong một phòng: đi vào phòng qua cửa rồi tới mốc (không xuyên tường).
      const room = floor.rooms.find((r) => pointInPolygon(landmark.position, r.polygon));
      return {
        keys: room ? roomGoals(floor, room) : new Set([q.attach(floor, landmark.position, tag)]),
        finalPoint: landmark.position,
        entryRoom: room,
        to: { floorId: floor.id, position: landmark.position, landmarkId: landmark.id },
        destinationName: landmark.name,
      };
    }
    const floor = floorOf(target.floorId);
    return {
      keys: new Set([q.attach(floor, target.position, tag)]),
      to: { floorId: floor.id, position: target.position },
      destinationName: 'điểm đến',
    };
  };

  const assemble = (q: RouteQuery, from: Location, goal: Goal, steps: PathStep<Arc>[]): Route => {
    const { finalPoint, entryRoom, destinationName } = goal;
    const goalNode = q.node(steps[steps.length - 1]!.key)!;
    const to = { ...goal.to, position: finalPoint ?? goalNode.position };

    // Chia đường đi theo tầng.
    const segments: RouteSegment[] = [];
    let current: RouteSegment | null = null;
    let transitionSeconds = 0;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const node = q.node(step.key)!;
      const prevNode = i > 0 ? q.node(steps[i - 1]!.key) : undefined;
      if (current && step.via?.connector && prevNode && prevNode.floorId !== node.floorId) {
        current.transition = {
          connectorId: step.via.connector.id,
          connectorType: step.via.connector.type,
          toFloorId: node.floorId,
        };
        transitionSeconds += connectorTravelSeconds(
          step.via.connector.type,
          floorOf(node.floorId).elevation - floorOf(prevNode.floorId).elevation,
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
      const lastFloor = floorOf(segments[segments.length - 1]!.floorId);
      // Nút phòng (giữa phòng) chỉ là điểm trung gian: từ cửa đi thẳng tới đích nếu không vướng
      // tường (ô cửa không tính là tường).
      const beforeGoal = path[path.length - 2];
      if (
        goalNode.node?.kind === 'room' &&
        beforeGoal &&
        !crossesWall(wallsOf(lastFloor), beforeGoal, finalPoint, 0.05)
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
        const n = q.node(steps[i]!.key)!;
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

    const floorName = (id: Id) => floors.get(id)?.name ?? id;
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
        const fromLevel = floorOf(s.floorId).level;
        const toLevel = floorOf(s.transition.toFloorId).level;
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
  };

  const routes = (from: Location, targets: readonly RouteTarget[]): (Route | null)[] => {
    const fromFloor = floorOf(from.floorId);
    const q = new RouteQuery(g, wallsOf);
    const start = q.attach(fromFloor, from.position, 'start');
    const goals = targets.map((t, i) => resolve(q, t, `goal${i}`));

    // Một lần Dijkstra; dừng khi mọi điểm đến đều đã có ít nhất một nút đích được chốt.
    const goalsOfKey = new Map<Key, number[]>();
    goals.forEach((goal, i) => {
      for (const k of goal.keys) goalsOfKey.set(k, [...(goalsOfKey.get(k) ?? []), i]);
    });
    const reached: (Key | undefined)[] = goals.map(() => undefined);
    let remaining = goals.length;
    const tree = dijkstra(start, q.neighbors, (key) => {
      for (const i of goalsOfKey.get(key) ?? []) {
        if (reached[i] === undefined) {
          reached[i] = key;
          remaining--;
        }
      }
      return remaining === 0;
    });

    return goals.map((goal, i) => {
      const key = reached[i];
      const steps = key === undefined ? null : pathTo(tree, key);
      return steps ? assemble(q, from, goal, steps) : null;
    });
  };

  return {
    building,
    options,
    routes,
    route: (from, target) => routes(from, [target])[0]!,
    assertTarget: (target) => void resolve(new RouteQuery(g, wallsOf), target, 'check'),
  };
}

/**
 * Tìm đường ngắn nhất (theo thời gian) từ `from` tới một phòng, một mốc hoặc một vị trí.
 * Trả về null nếu không có đường đi. Tìm nhiều lần trên cùng một toà: dùng `createBuildingRouter`.
 */
export function findRoute(
  building: Building,
  from: Location,
  target: RouteTarget,
  options: RouteOptions = {},
): Route | null {
  return createBuildingRouter(building, options).route(from, target);
}
