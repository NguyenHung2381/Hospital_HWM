/**
 * Thang bộ / thang cuốn trong 3D, dựng theo kiểu thang hai vế thật:
 * - vế LÊN: các bậc nổi cao dần trên mặt sàn;
 * - vế XUỐNG: các bậc chìm dần qua một lỗ khoét trên tấm sàn.
 * Tầng có cả tầng trên lẫn tầng dưới thì chia đôi bề ngang thang thành hai vế song song, chung
 * một đầu vào ngang mặt sàn — nhìn là biết ngay đi hướng nào để lên, hướng nào để xuống.
 */
import * as THREE from 'three';
import {
  dot,
  pointInPolygon,
  scale,
  sub,
  type Connector,
  type Floor,
  type Id,
  type Point,
} from '@hwn/map-core';
import { connectorFrame, framePoint, frameRect, type ConnectorFrame } from '../core/connectors';
import { mergeAll, prism, toVec3, type Vec3 } from './geometry';

export type FlightDirection = 'up' | 'down';

export interface StairFlight {
  direction: FlightDirection;
  /** Hệ trục của vế: đi dọc `dir` từ đầu vào (`tMin`, ngang mặt sàn) tới cuối vế (`tMax`). */
  frame: ConnectorFrame;
}

export interface StairLayout {
  connector: Connector;
  flights: StairFlight[];
}

/** Điểm nối vào thang trên đồ thị dẫn đường (thường là nút cửa thang). */
function entryPoint(floor: Floor, connector: Connector): Point | undefined {
  const { nodes, edges } = floor.navGraph;
  const inside = nodes.find((n) => n.kind === 'connector' && n.refId === connector.id);
  if (!inside) return undefined;
  const edge = edges.find((e) => e.from === inside.id || e.to === inside.id);
  const otherId = edge && (edge.from === inside.id ? edge.to : edge.from);
  return nodes.find((n) => n.id === otherId)?.position;
}

/**
 * Hệ trục thang theo hướng đi lên. Dữ liệu không ghi `heading` thì chọn chiều sao cho chân thang
 * nằm phía cửa vào, tránh cảnh vừa bước vào đã gặp đỉnh thang.
 */
function stairFrame(floor: Floor, connector: Connector): ConnectorFrame {
  const f = connectorFrame(connector);
  if (connector.heading !== undefined) return f;
  const entry = entryPoint(floor, connector);
  if (!entry || dot(sub(entry, f.center), f.dir) <= 0) return f;
  return {
    ...f,
    dir: scale(f.dir, -1),
    normal: scale(f.normal, -1),
    tMin: -f.tMax,
    tMax: -f.tMin,
  };
}

/** Phần dải bề ngang `s0..s1` của thang, giữ nguyên chiều dọc. */
const laneFrame = (f: ConnectorFrame, s0: number, s1: number): ConnectorFrame => ({
  ...f,
  center: framePoint(f, 0, (s0 + s1) / 2),
  halfWidth: (s1 - s0) / 2,
});

/**
 * Bố trí vế thang cho mọi thang bộ/thang cuốn của toà nhà, theo id thang.
 * @param floors các tầng đã sắp theo cao độ, từ thấp lên cao.
 */
export function stairLayouts(floors: readonly Floor[]): Map<Id, StairLayout> {
  const floorsByLink = new Map<Id, number[]>();
  floors.forEach((floor, i) => {
    for (const c of floor.connectors) {
      floorsByLink.set(c.linkId, [...(floorsByLink.get(c.linkId) ?? []), i]);
    }
  });

  const layouts = new Map<Id, StairLayout>();
  floors.forEach((floor, i) => {
    for (const connector of floor.connectors) {
      if (connector.type === 'elevator') continue;
      const linked = floorsByLink.get(connector.linkId) ?? [];
      const up = linked.some((j) => j > i) && connector.direction !== 'down';
      const down = linked.some((j) => j < i) && connector.direction !== 'up';
      const f = stairFrame(floor, connector);
      let flights: StairFlight[];
      if (up && down) {
        const gap = Math.min(0.12, f.halfWidth * 0.1);
        flights = [
          { direction: 'up', frame: laneFrame(f, -f.halfWidth, -gap / 2) },
          { direction: 'down', frame: laneFrame(f, gap / 2, f.halfWidth) },
        ];
      } else {
        // Thang lẻ (chưa nối tầng nào) vẫn vẽ vế lên như trước.
        flights = [{ direction: down ? 'down' : 'up', frame: f }];
      }
      layouts.set(connector.id, { connector, flights });
    }
  });
  return layouts;
}

/* ------------------------------------------------------------------ */
/* Đi trên thang                                                       */
/* ------------------------------------------------------------------ */

const flightLength = (f: ConnectorFrame) => f.tMax - f.tMin;

/**
 * Vị trí ngang trên vế thang (tỉ lệ nửa bề ngang): tuyến đường đi lệch một bên, mũi tên và chữ
 * nằm lệch bên kia để không bị nét tuyến che mất.
 */
const ROUTE_SIDE = -0.6;
const MARK_SIDE = 0.3;

/** Cao độ (so với mặt sàn) của đường dốc nối mép các bậc tại vị trí `t` dọc vế thang. */
function slopeY(flight: StairFlight, t: number, height: number) {
  const k = Math.min(1, Math.max(0, (t - flight.frame.tMin) / flightLength(flight.frame)));
  return flight.direction === 'up' ? k * height : -k * height;
}

/**
 * Hai điểm của tuyến khi đi qua vế thang: đầu vào (ngang mặt sàn) và cuối vế (cao/thấp hơn sàn
 * `height`). `lift` là khoảng nâng tuyến lên khỏi mặt bậc.
 */
export function flightPath(
  flight: StairFlight,
  height: number,
  floorY: number,
  lift: number,
): [Vec3, Vec3] {
  const f = flight.frame;
  const end = f.tMax - Math.min(0.3, flightLength(f) * 0.1);
  const s = f.halfWidth * ROUTE_SIDE;
  return [
    toVec3(framePoint(f, f.tMin, s), floorY + lift),
    toVec3(framePoint(f, end, s), floorY + lift + slopeY(flight, end, height)),
  ];
}

/** Vế thang dùng để đi từ tầng này lên (`up`) hoặc xuống (`down`) tầng kế tiếp. */
export const flightFor = (layout: StairLayout, direction: FlightDirection): StairFlight =>
  layout.flights.find((f) => f.direction === direction) ?? layout.flights[0]!;

export const insideConnector = (layout: StairLayout, p: Point) =>
  pointInPolygon(p, layout.connector.polygon);

/* ------------------------------------------------------------------ */
/* Hình học                                                            */
/* ------------------------------------------------------------------ */

/** Mặt (phẳng hoặc nghiêng theo dốc thang) từ đa giác trong hệ trục vế thang (t, s). */
function slopedSurface(
  flight: StairFlight,
  outline: readonly [t: number, s: number][],
  height: number,
  offset: number,
  uvs?: readonly [number, number][],
): THREE.BufferGeometry {
  const contour = outline.map(([t, s]) => new THREE.Vector2(t, s));
  const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
  const positions = outline.flatMap(([t, s]) =>
    toVec3(framePoint(flight.frame, t, s), slopeY(flight, t, height) + offset),
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (uvs) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs.flat(), 2));
  geometry.setIndex(triangles.flat());
  geometry.computeVertexNormals();
  return geometry;
}

/** Mũi tên nằm trên mặt dốc, chỉ theo chiều đi của vế (lên dốc hoặc xuống dốc). */
function arrowOutline(f: ConnectorFrame): [number, number][] {
  const len = flightLength(f);
  const t0 = f.tMin + len * 0.45;
  const t1 = f.tMax - Math.min(0.3, len * 0.08);
  const headLen = Math.min(1, (t1 - t0) * 0.5);
  const shaft = Math.min(0.12, f.halfWidth * 0.18);
  const head = Math.min(0.45, f.halfWidth * 0.5);
  const c = f.halfWidth * MARK_SIDE;
  return [
    [t0, c - shaft],
    [t1 - headLen, c - shaft],
    [t1 - headLen, c - head],
    [t1, c],
    [t1 - headLen, c + head],
    [t1 - headLen, c + shaft],
    [t0, c + shaft],
  ];
}

export interface StairGeometry {
  /** Bậc của các vế lên. */
  up: THREE.BufferGeometry | null;
  /** Bậc của các vế xuống (nằm dưới mặt sàn). */
  down: THREE.BufferGeometry | null;
  /** Vách quanh hố thang xuống. */
  pit: THREE.BufferGeometry | null;
  arrows: THREE.BufferGeometry | null;
  /** Ô chữ "LÊN"/"XUỐNG" nằm trên mặt dốc, gần đầu vào của từng vế. */
  labels: Record<FlightDirection, THREE.BufferGeometry | null>;
  /** Lỗ khoét trên tấm sàn cho các vế xuống. */
  holes: Point[][];
}

const PIT_WALL = 0.08;
const PIT_BOTTOM = 0.1;

/**
 * Dựng toàn bộ thang của một tầng (đã gộp theo vật liệu).
 * @param height độ cao một vế (bằng chiều cao tường đang hiển thị).
 * @param labelAspect tỉ lệ rộng/cao của ảnh chữ từng hướng, để ô chữ không bị méo.
 */
export function buildStairGeometry(
  layouts: readonly StairLayout[],
  height: number,
  labelAspect: Record<FlightDirection, number>,
): StairGeometry {
  const up: THREE.BufferGeometry[] = [];
  const down: THREE.BufferGeometry[] = [];
  const pit: THREE.BufferGeometry[] = [];
  const arrows: THREE.BufferGeometry[] = [];
  const labels: Record<FlightDirection, THREE.BufferGeometry[]> = { up: [], down: [] };
  const holes: Point[][] = [];

  for (const { connector, flights } of layouts) {
    const steps = connector.type === 'stairs' ? 10 : 16;
    for (const flight of flights) {
      const f = flight.frame;
      const len = flightLength(f);
      const rise = height / steps;
      for (let i = 0; i < steps; i++) {
        const rect = frameRect(f, f.tMin + (len * i) / steps, f.tMin + (len * (i + 1)) / steps);
        if (flight.direction === 'up') up.push(prism(rect, 0, rise * (i + 1)));
        else down.push(prism(rect, -height - PIT_BOTTOM, -rise * (i + 1)));
      }
      if (flight.direction === 'down') {
        holes.push(frameRect(f, f.tMin, f.tMax));
        const hw = f.halfWidth;
        const w = PIT_WALL;
        const box = (t0: number, t1: number, s0: number, s1: number) =>
          prism(
            [
              framePoint(f, t0, s0),
              framePoint(f, t1, s0),
              framePoint(f, t1, s1),
              framePoint(f, t0, s1),
            ],
            -height - PIT_BOTTOM,
            0,
          );
        pit.push(
          box(f.tMin, f.tMax + w, -hw - w, -hw),
          box(f.tMin, f.tMax + w, hw, hw + w),
          box(f.tMax, f.tMax + w, -hw, hw),
        );
      }

      // Đặt mũi tên/chữ cao hơn mặt dốc một bậc để không bị mép bậc che.
      const offset = (flight.direction === 'up' ? rise : 0) + 0.03;
      arrows.push(slopedSurface(flight, arrowOutline(f), height, offset));

      const margin = Math.min(0.3, len * 0.08);
      let labelW = f.halfWidth * 1.1;
      let labelH = labelW / labelAspect[flight.direction];
      const maxH = len * 0.45 - margin;
      if (labelH > maxH) {
        labelW *= maxH / labelH;
        labelH = maxH;
      }
      const t0 = f.tMin + margin;
      const t1 = t0 + labelH;
      const c = f.halfWidth * MARK_SIDE;
      // Chân chữ quay về phía đầu vào: đứng ở chân thang nhìn vào là đọc được.
      labels[flight.direction].push(
        slopedSurface(
          flight,
          [
            [t0, c - labelW / 2],
            [t0, c + labelW / 2],
            [t1, c + labelW / 2],
            [t1, c - labelW / 2],
          ],
          height,
          offset,
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        ),
      );
    }
  }

  return {
    up: mergeAll(up),
    down: mergeAll(down),
    pit: mergeAll(pit),
    arrows: mergeAll(arrows),
    labels: { up: mergeAll(labels.up), down: mergeAll(labels.down) },
    holes,
  };
}

export function disposeStairGeometry(g: StairGeometry) {
  for (const geometry of [g.up, g.down, g.pit, g.arrows, g.labels.up, g.labels.down]) {
    geometry?.dispose();
  }
}
