import { describe, expect, it } from 'vitest';
import { buildingFootprint, type Campus, type SitePath } from './campus';
import {
  campusSiteParts,
  campusSitePlan,
  campusSockets,
  exteriorSockets,
  placeExterior,
  socketConnector,
  socketLinked,
} from './exterior';
import { distance } from './geometry';
import { lobbyExterior } from './lobby';
import { createSampleAnnex, createSampleBuilding, createSampleCampus } from './sample';
import type { Building } from './types';

const sample = () => {
  const buildings = new Map<string, Building>(
    [createSampleBuilding(), createSampleAnnex()].map((b) => [b.id, b]),
  );
  return {
    campus: createSampleCampus(),
    buildings,
    exteriorOf: (id: string) => buildings.get(id)?.exterior,
    footprintOf: (id: string) => {
      const b = buildings.get(id);
      return b ? buildingFootprint(b) : undefined;
    },
  };
};

describe('sảnh đón dựng sẵn', () => {
  const ext = lobbyExterior({
    door: { x: 0, y: 10 },
    outward: { x: -1, y: 0 },
    use: 'outpatient',
    title: 'Khám bệnh',
    id: (k) => k,
  });

  it('sảnh sát tường, làn đón một chiều, hai dốc từ chân dốc lên hai đầu làn', () => {
    const lobby = ext.areas.find((a) => a.id === 'lobby')!;
    expect(lobby.kind).toBe('plaza');
    expect(Math.max(...lobby.polygon.map((p) => p.x))).toBe(0);
    expect(Math.min(...lobby.polygon.map((p) => p.x))).toBe(-7);
    const lane = ext.paths.find((p) => p.id === 'lane')!;
    expect(lane.oneWay).toBe(true);
    // Xe chạy bên phải: làn đi theo chiều toà nằm bên phải (cửa ở phía đông → đi về phía bắc).
    expect(lane.points[1]!.y).toBeLessThan(lane.points[0]!.y);
    const up = ext.paths.find((p) => p.id === 'ramp_up')!;
    const down = ext.paths.find((p) => p.id === 'ramp_down')!;
    expect(up.points[0]).toEqual({ x: -13.75, y: 22.5 });
    expect(up.points[up.points.length - 1]).toEqual(lane.points[0]);
    expect(down.points[down.points.length - 1]).toEqual(lane.points[1]);
    expect([up.flow, down.flow]).toEqual(['up', 'down']);
    // Lối đi bộ của cả hai dốc nằm phía toà nhà.
    expect([up.walkway, down.walkway]).toEqual(['right', 'left']);
    expect(new Set(ext.paths.map((p) => p.use))).toEqual(new Set(['outpatient']));
  });

  it('xoay theo hướng cửa: cửa nhìn xuống phía nam thì sảnh nằm phía nam', () => {
    const south = lobbyExterior({ door: { x: 5, y: 20 }, outward: { x: 0, y: 1 }, id: (k) => k });
    const lobby = south.areas.find((a) => a.id === 'lobby')!;
    expect(Math.min(...lobby.polygon.map((p) => p.y))).toBe(20);
    expect(Math.max(...lobby.polygon.map((p) => p.y))).toBe(27);
    const up = south.paths.find((p) => p.id === 'ramp_up')!;
    // Xe đi về phía tây (toà bên phải) nên vào ở phía đông.
    expect(up.points[0]).toEqual({ x: 17.5, y: 33.75 });
  });
});

describe('ghép phần ngoài trời của toà vào mặt bằng tổng thể', () => {
  it('đặt theo vị trí + góc xoay của toà', () => {
    const ext = {
      areas: [],
      paths: [
        {
          id: 'p',
          kind: 'pedestrian' as const,
          width: 2,
          points: [
            { x: 1, y: 0 },
            { x: 2, y: 0 },
          ],
        },
      ],
    };
    const placed = placeExterior({ position: { x: 10, y: 5 }, rotation: 90 }, ext);
    expect(placed.paths[0]!.points[0]!.x).toBeCloseTo(10);
    expect(placed.paths[0]!.points[0]!.y).toBeCloseTo(6);
  });

  it('ghi toà sở hữu, lưu đệm theo dữ liệu', () => {
    const { campus, exteriorOf } = sample();
    const a = campusSiteParts(campus, exteriorOf);
    expect(a.owner.get('ext_main~ramp_up')).toBe('bld_hwn_demo');
    expect(a.owner.get('ext_annex~lobby')).toBe('bld_hwn_annex');
    expect(a.owner.has('site_road_west')).toBe(false);
    // Khu B đặt ở y = 35: sảnh Cấp cứu nằm trước cửa chính của Khu B.
    const annexLobby = a.site.areas.find((x) => x.id === 'ext_annex~lobby')!;
    expect(Math.min(...annexLobby.polygon.map((p) => p.y))).toBe(38);
    expect(campusSiteParts(campus, exteriorOf)).toBe(a);
    expect(campusSitePlan({ buildings: [] }, () => undefined)).toBeUndefined();
  });
});

describe('đầu nối của toà', () => {
  it('chân dốc (đường xe) và chân lối đi bộ trên dốc; đầu làn đón nối với đỉnh dốc thì không', () => {
    const b = createSampleBuilding();
    const sockets = exteriorSockets(b.exterior!, buildingFootprint(b));
    expect(
      sockets
        .filter((s) => s.kind === 'road')
        .map((s) => s.id)
        .sort(),
    ).toEqual(['ext_main~ramp_down:start', 'ext_main~ramp_up:start']);
    expect(sockets.filter((s) => s.kind === 'walk')).toHaveLength(2);
    const up = sockets.find((s) => s.id === 'ext_main~ramp_up:start')!;
    // Chân dốc lên ở phía nam, đi ra khỏi dốc theo hướng nam.
    expect(up.dir.y).toBeGreaterThan(0.9);
  });

  it('dữ liệu mẫu: mọi đầu nối đã chạm đường nội bộ / vỉa hè', () => {
    const { campus, exteriorOf, footprintOf } = sample();
    const sockets = campusSockets(campus, exteriorOf, footprintOf);
    expect(sockets).toHaveLength(8);
    expect(sockets.filter((s) => !s.linked)).toEqual([]);
  });

  it('dời toà ra xa đường: đầu nối chưa nối; tạo đoạn nối vào đường gần nhất thì nối được', () => {
    const { campus, exteriorOf, footprintOf } = sample();
    const moved: Campus = {
      ...campus,
      buildings: campus.buildings.map((pl) =>
        pl.buildingId === 'bld_hwn_demo' ? { ...pl, position: { x: 12, y: 0 } } : pl,
      ),
    };
    const sockets = campusSockets(moved, exteriorOf, footprintOf).filter(
      (s) => s.buildingId === 'bld_hwn_demo',
    );
    expect(sockets.every((s) => !s.linked)).toBe(true);
    const { site, owner } = campusSiteParts(moved, exteriorOf);
    const mine = (id: string) => owner.get(id) === 'bld_hwn_demo';
    const foot = sockets.find((s) => s.id === 'ext_main~ramp_up:start')!;
    const conn = socketConnector(foot, site, mine)!;
    expect(conn.kind).toBe('vehicle');
    expect(conn.points[0]).toEqual({
      x: Math.round(foot.position.x * 100) / 100,
      y: Math.round(foot.position.y * 100) / 100,
    });
    // Đầu kia nằm trên tim đường nội bộ (x = −16).
    expect(conn.points[conn.points.length - 1]!.x).toBeCloseTo(-16, 1);
    const withConn = { ...site, paths: [...site.paths, { ...conn, id: 'c' } as SitePath] };
    expect(socketLinked(foot, withConn, mine)).toBe(true);
    expect(socketConnector(foot, withConn, mine)).toBeNull();
  });

  it('lối đi bộ nối vào lối đi bộ / sân gần nhất', () => {
    const walk = {
      kind: 'walk' as const,
      position: { x: 0, y: 0 },
      dir: { x: 1, y: 0 },
      width: 1.5,
    };
    const plan = {
      areas: [],
      paths: [
        {
          id: 'w',
          kind: 'pedestrian' as const,
          width: 2,
          points: [
            { x: 10, y: -5 },
            { x: 10, y: 5 },
          ],
        },
      ],
    };
    const conn = socketConnector(walk, plan)!;
    expect(conn.kind).toBe('pedestrian');
    expect(distance(conn.points[conn.points.length - 1]!, { x: 10, y: 0 })).toBeLessThan(1e-6);
  });
});
