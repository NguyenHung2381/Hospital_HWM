import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { createApiClient, createTrafficStream, type TrafficStreamStatus } from '@hwn/api-client';
import type { TrafficSnapshot } from '@hwn/map-core';
import { createSampleBuilding, SAMPLE_BUILDING_ID } from '@hwn/map-core/sample';
import { resetMockDb } from './db';
import { createHandlers } from './handlers';
import { busyness, TrafficSimulator } from './traffic';

const at = (hour: number) => new Date(2026, 9, 2, hour, 0, 0).getTime();

describe('TrafficSimulator', () => {
  it('đông vào giờ cao điểm, vắng ban đêm', () => {
    expect(busyness(9)).toBeGreaterThan(0.9);
    expect(busyness(3)).toBeLessThan(0.15);
    const building = createSampleBuilding();
    const morning = new TrafficSimulator(
      () => building,
      () => at(9),
    );
    const night = new TrafficSimulator(
      () => building,
      () => at(3),
    );
    expect(morning.targetCount()).toBeGreaterThan(night.targetCount() * 3);
  });

  it('tổng số người = tổng theo từng đoạn; liệt kê đủ mọi đoạn; người có di chuyển', () => {
    const building = createSampleBuilding();
    let now = at(10);
    const sim = new TrafficSimulator(
      () => building,
      () => now,
    );
    const first = sim.snapshot();
    const edgeCount = building.floors.reduce((n, f) => n + f.navGraph.edges.length, 0);
    expect(first.edges).toHaveLength(edgeCount);
    expect(first.totalActive).toBe(first.edges.reduce((s, e) => s + e.count, 0));
    expect(first.totalActive).toBeGreaterThan(sim.targetCount() * 0.8);

    const before = sim.positions();
    now += 3000;
    sim.tick();
    const after = sim.positions();
    const moved = after.filter(
      (p, i) =>
        before[i] &&
        (p.position.x !== before[i]!.position.x || p.position.y !== before[i]!.position.y),
    );
    expect(moved.length).toBeGreaterThan(after.length / 2);
  });

  it('lọc theo tầng', () => {
    const building = createSampleBuilding();
    const sim = new TrafficSimulator(
      () => building,
      () => at(10),
    );
    const s = sim.snapshot('floor_2');
    expect(s.edges.every((e) => e.floorId === 'floor_2')).toBe(true);
  });

  it('lịch sử: đúng số điểm, ổn định theo thời điểm, chia theo tầng', () => {
    const building = createSampleBuilding();
    const sim = new TrafficSimulator(
      () => building,
      () => at(12),
    );
    const h = sim.history(24, 30);
    expect(h).toHaveLength(49);
    expect(sim.history(24, 30)).toEqual(h); // cùng mốc → cùng giá trị
    const p = h[h.length - 1]!;
    const sum = Object.values(p.byFloor).reduce((s, v) => s + v, 0);
    expect(Math.abs(sum - p.totalActive)).toBeLessThanOrEqual(1);
    expect(p.byFloor.floor_1!).toBeGreaterThan(p.byFloor.floor_2!);
  });
});

describe('createTrafficStream', () => {
  const BASE = 'http://localhost/api';
  const server = setupServer(...createHandlers(BASE));
  const api = createApiClient({ baseURL: BASE });
  beforeAll(() => {
    resetMockDb({ sample: true });
    server.listen({ onUnhandledRequest: 'bypass' });
  });
  afterAll(() => server.close());

  /** Chạy stream cho tới khi nhận ảnh chụp đầu tiên (hoặc hết thời gian). */
  function firstSnapshot(url: string) {
    return new Promise<{ snapshot: TrafficSnapshot; statuses: TrafficStreamStatus[] }>(
      (resolve, reject) => {
        const statuses: TrafficStreamStatus[] = [];
        const timeout = setTimeout(() => {
          stream.close();
          reject(new Error(`Không nhận được dữ liệu; trạng thái: ${statuses.join(' → ')}`));
        }, 4000);
        const stream = createTrafficStream({
          url,
          poll: () => api.traffic.snapshot(SAMPLE_BUILDING_ID),
          onStatus: (s) => statuses.push(s),
          onSnapshot: (snapshot) => {
            clearTimeout(timeout);
            stream.close();
            resolve({ snapshot, statuses: [...statuses] });
          },
          connectTimeoutMs: 500,
          pollIntervalMs: 200,
        });
      },
    );
  }

  it('nhận dữ liệu qua WebSocket', async () => {
    const url = api.traffic.streamUrl(SAMPLE_BUILDING_ID);
    expect(url).toBe(`ws://localhost/api/buildings/${SAMPLE_BUILDING_ID}/traffic/stream`);
    const { snapshot, statuses } = await firstSnapshot(url);
    expect(statuses).toEqual(['connecting', 'live']);
    expect(snapshot.buildingId).toBe(SAMPLE_BUILDING_ID);
  });

  it('WebSocket không kết nối được thì chuyển sang polling', async () => {
    const { snapshot, statuses } = await firstSnapshot('ws://127.0.0.1:9/khong-ton-tai');
    expect(statuses).toContain('polling');
    expect(statuses).not.toContain('live');
    expect(snapshot.edges.length).toBeGreaterThan(0);
  });
});
