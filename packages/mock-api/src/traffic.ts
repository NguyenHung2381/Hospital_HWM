/**
 * Mô phỏng người đi lại trong viện để mock API trả về lưu lượng "giống thật":
 * mỗi người đi theo một tuyến đường thật (cửa chính → phòng, phòng → phòng, có thể qua thang),
 * số người thay đổi theo giờ trong ngày. Lưu lượng của mỗi đoạn = số người đang ở gần đoạn đó.
 */
import type { TrafficHistoryPoint } from '@hwn/api-client';
import {
  distance,
  lerp,
  projectPointOnSegment,
  type Building,
  type EdgeTraffic,
  type Floor,
  type Id,
  type Location,
  type Point,
  type Route,
  type TrafficSnapshot,
} from '@hwn/map-core';
import { buildingRouter } from './routers';

/** Mức đông theo giờ (0..1): cao điểm sáng ~9h, chiều ~14h30. */
export function busyness(hour: number): number {
  const g = (mu: number, sigma: number) => Math.exp(-((hour - mu) ** 2) / (2 * sigma * sigma));
  return Math.min(1, 0.08 + g(9, 1.6) + 0.8 * g(14.5, 1.5));
}

const MIN_AGENTS = 12;
const MAX_AGENTS = 120;
const WALK_SPEED = 1.2; // m/s
const MAX_TICK_SECONDS = 5;

interface Leg {
  floorId: Id;
  path: Point[];
  length: number;
}

interface Agent {
  legs: Leg[];
  leg: number;
  /** Quãng đường đã đi trên chặng hiện tại (m). */
  progress: number;
  speed: number;
}

function legsOf(route: Route): Leg[] {
  return route.segments
    .filter((s) => s.path.length >= 2)
    .map((s) => ({
      floorId: s.floorId,
      path: s.path,
      length: s.path.reduce((sum, p, i) => (i ? sum + distance(s.path[i - 1]!, p) : 0), 0),
    }));
}

function positionOn(leg: Leg, progress: number): Point {
  let remaining = progress;
  for (let i = 1; i < leg.path.length; i++) {
    const a = leg.path[i - 1]!;
    const b = leg.path[i]!;
    const d = distance(a, b);
    if (remaining <= d) return d === 0 ? a : lerp(a, b, remaining / d);
    remaining -= d;
  }
  return leg.path[leg.path.length - 1]!;
}

const pick = <T>(items: readonly T[]): T | undefined =>
  items[Math.floor(Math.random() * items.length)];

export class TrafficSimulator {
  private agents: Agent[] = [];
  private lastTick = 0;

  constructor(
    private readonly getBuilding: () => Building | undefined,
    private readonly now: () => number = Date.now,
  ) {}

  /** Số người mục tiêu ở thời điểm hiện tại. */
  targetCount(): number {
    const d = new Date(this.now());
    const hour = d.getHours() + d.getMinutes() / 60;
    return Math.round(MIN_AGENTS + (MAX_AGENTS - MIN_AGENTS) * busyness(hour));
  }

  private spawn(building: Building): Agent | null {
    const rooms = building.floors.flatMap((f) =>
      f.navGraph.nodes
        .filter((n) => n.kind === 'room' && n.refId)
        .map((n) => ({ floorId: f.id, position: n.position, roomId: n.refId! })),
    );
    const entrances = building.floors.flatMap((f) =>
      f.navGraph.nodes
        .filter((n) => n.kind === 'entrance')
        .map((n) => ({ floorId: f.id, position: n.position })),
    );
    const target = pick(rooms);
    if (!target) return null;
    // Phần lớn người đi từ cửa chính vào; số còn lại đi giữa các phòng.
    const from: Location | undefined =
      Math.random() < 0.55 && entrances.length ? pick(entrances) : pick(rooms);
    if (!from) return null;
    try {
      const route = buildingRouter(building).route(from, { roomId: target.roomId });
      const legs = route ? legsOf(route) : [];
      if (!legs.length) return null;
      return { legs, leg: 0, progress: 0, speed: WALK_SPEED * (0.7 + Math.random() * 0.6) };
    } catch {
      return null;
    }
  }

  /** Cho mọi người đi tiếp theo thời gian thực đã trôi qua, rồi bổ sung/bớt người theo giờ. */
  tick(): void {
    const building = this.getBuilding();
    if (!building) return;
    const now = this.now();
    const first = this.lastTick === 0;
    const dt = first ? 0 : Math.min(MAX_TICK_SECONDS, (now - this.lastTick) / 1000);
    this.lastTick = now;

    for (const a of this.agents) {
      a.progress += a.speed * dt;
      while (a.leg < a.legs.length && a.progress >= a.legs[a.leg]!.length) {
        a.progress -= a.legs[a.leg]!.length;
        a.leg++;
      }
    }
    this.agents = this.agents.filter((a) => a.leg < a.legs.length);

    const target = this.targetCount();
    // Lần đầu: rải người ở các vị trí ngẫu nhiên dọc tuyến để không dồn hết ở điểm xuất phát.
    let guard = 0;
    while (this.agents.length < target && guard++ < target * 3) {
      const agent = this.spawn(building);
      if (!agent) continue;
      if (first || Math.random() < 0.3) {
        agent.leg = Math.floor(Math.random() * agent.legs.length);
        agent.progress = Math.random() * agent.legs[agent.leg]!.length;
      }
      this.agents.push(agent);
    }
    if (this.agents.length > target * 1.2) this.agents.length = Math.ceil(target * 1.2);
  }

  /** Vị trí hiện tại của từng người (sau `tick`). */
  positions(): Location[] {
    return this.agents.map((a) => {
      const leg = a.legs[a.leg]!;
      return { floorId: leg.floorId, position: positionOn(leg, a.progress) };
    });
  }

  snapshot(floorId?: Id | null): TrafficSnapshot {
    this.tick();
    const building = this.getBuilding();
    const counts = new Map<string, EdgeTraffic>();
    if (building) {
      const floors = new Map(building.floors.map((f) => [f.id, f]));
      for (const loc of this.positions()) {
        if (floorId && loc.floorId !== floorId) continue;
        const floor = floors.get(loc.floorId);
        const edgeId = floor && nearestEdge(floor, loc.position);
        if (!floor || !edgeId) continue;
        const key = `${floor.id}:${edgeId}`;
        const entry = counts.get(key) ?? { floorId: floor.id, edgeId, count: 0 };
        entry.count++;
        counts.set(key, entry);
      }
      // Liệt kê cả các đoạn đang vắng (count = 0) để client tô đủ bản đồ.
      for (const floor of building.floors) {
        if (floorId && floor.id !== floorId) continue;
        for (const e of floor.navGraph.edges) {
          const key = `${floor.id}:${e.id}`;
          if (!counts.has(key)) counts.set(key, { floorId: floor.id, edgeId: e.id, count: 0 });
        }
      }
    }
    const edges = [...counts.values()];
    return {
      buildingId: building?.id ?? '',
      timestamp: new Date(this.now()).toISOString(),
      totalActive: edges.reduce((s, e) => s + e.count, 0),
      edges,
    };
  }

  /**
   * Lịch sử tổng hợp (dữ liệu giả lập theo đường cong giờ trong ngày + nhiễu ổn định),
   * mỗi điểm là đầu một khoảng `bucketMinutes` phút.
   */
  history(hours = 24, bucketMinutes = 15): TrafficHistoryPoint[] {
    const building = this.getBuilding();
    const floors = building ? [...building.floors].sort((a, b) => a.level - b.level) : [];
    const bucketMs = bucketMinutes * 60_000;
    const end = Math.floor(this.now() / bucketMs) * bucketMs;
    const points: TrafficHistoryPoint[] = [];
    for (let t = end - hours * 3_600_000; t <= end; t += bucketMs) {
      const d = new Date(t);
      const hour = d.getHours() + d.getMinutes() / 60;
      // Nhiễu ổn định theo thời điểm: cùng một mốc luôn cho cùng một giá trị.
      const noise = 1 + 0.12 * Math.sin(t / 3_700_000) + 0.06 * Math.sin(t / 911_000);
      const total = Math.max(
        0,
        Math.round((MIN_AGENTS + (MAX_AGENTS - MIN_AGENTS) * busyness(hour)) * noise),
      );
      const byFloor: Record<Id, number> = {};
      // Tầng thấp (có cửa chính) đông hơn.
      const weights = floors.map((_, i) => 1 / (i + 1.5));
      const sum = weights.reduce((s, w) => s + w, 0) || 1;
      floors.forEach((f, i) => (byFloor[f.id] = Math.round((total * weights[i]!) / sum)));
      points.push({ timestamp: d.toISOString(), totalActive: total, byFloor });
    }
    return points;
  }
}

/** Cạnh đồ thị gần điểm `p` nhất trên tầng. */
function nearestEdge(floor: Floor, p: Point): Id | null {
  const nodes = new Map(floor.navGraph.nodes.map((n) => [n.id, n.position]));
  let best: { id: Id; d: number } | null = null;
  for (const e of floor.navGraph.edges) {
    const a = nodes.get(e.from);
    const b = nodes.get(e.to);
    if (!a || !b) continue;
    const d = projectPointOnSegment(p, a, b).distance;
    if (!best || d < best.d) best = { id: e.id, d };
  }
  return best?.id ?? null;
}
