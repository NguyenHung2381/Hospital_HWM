import { describe, expect, it } from 'vitest';
import {
  buildingDoors,
  campusGroundLevel,
  campusLevels,
  floorAtLevel,
  validateCampus,
  campusBuildingInfo,
  rampCenterline,
  rampWalkLines,
  type Campus,
  type SitePath,
} from './campus';
import {
  buildSiteWalkGraph,
  campusRouteToSiteRoute,
  findCampusRoute,
  isWalkable,
  levelOfFloorId,
  type CampusRoute,
} from './campusRoute';
import { projectPointOnSegment } from './geometry';
import {
  createSampleAnnex,
  createSampleBuilding,
  createSampleCampus,
  createSampleSitePlan,
  SAMPLE_ANNEX_ID,
  SAMPLE_BUILDING_ID,
} from './sample';
import type { Building, Id } from './types';

const setup = () => {
  const main = createSampleBuilding();
  const annex = createSampleAnnex();
  const buildings = new Map<Id, Building>([
    [main.id, main],
    [annex.id, annex],
  ]);
  return { campus: createSampleCampus(), buildings, main, annex };
};

const kinds = (r: CampusRoute) => r.legs.map((l) => l.kind);

describe('tầng chung của cơ sở', () => {
  it('liệt kê tầng, tầng mặt đất và tầng của toà theo levelOffset', () => {
    const { campus, buildings, main } = setup();
    const levelsOf = (id: Id) => buildings.get(id)?.floors.map((f) => f.level);
    expect(campusLevels(campus, levelsOf)).toEqual([1, 2]);
    expect(campusGroundLevel(campus, levelsOf)).toBe(1);
    const shifted = { ...campus.buildings[0]!, levelOffset: 1 };
    expect(floorAtLevel(main, shifted, 2)?.id).toBe('floor_1');
    expect(floorAtLevel(main, shifted, 1)).toBeUndefined();
  });

  it('liệt kê cửa đi / cửa chính, bỏ cửa sổ', () => {
    const doors = buildingDoors(createSampleBuilding());
    expect(doors.some((d) => d.type === 'entrance' && d.floorId === 'floor_1')).toBe(true);
    expect(doors.every((d) => d.type !== 'window')).toBe(true);
  });

  it('nhận ra cửa trên tường ngoài (đầu cầu được) và cửa phòng bên trong', () => {
    const doors = buildingDoors(createSampleBuilding());
    const entrance = doors.find((d) => d.type === 'entrance')!;
    expect(entrance.exterior).toBe(true);
    const roomDoor = doors.find((d) => d.openingId === 'floor_2_door_bot1')!;
    expect(roomDoor.exterior).toBe(false);
  });

  it('kiểm tra cầu nối trỏ tới cửa không tồn tại / cùng một toà', () => {
    const { campus, buildings } = setup();
    const info = new Map([...buildings.values()].map((b) => [b.id, campusBuildingInfo(b)]));
    const bad: Campus = {
      ...campus,
      links: [
        {
          id: 'l1',
          name: 'Cầu A',
          kind: 'bridge',
          a: { buildingId: SAMPLE_BUILDING_ID, floorId: 'floor_2', openingId: 'khong_co' },
          b: { buildingId: SAMPLE_BUILDING_ID, floorId: 'floor_2', openingId: 'khong_co' },
          accessible: true,
          covered: true,
        },
      ],
    };
    const codes = validateCampus(bad, info).issues.map((i) => i.code);
    expect(codes).toContain('LINK_SAME_BUILDING');
    expect(codes).toContain('LINK_MISSING_DOOR');
    expect(validateCampus(campus, info).valid).toBe(true);
  });
});

describe('đồ thị đi bộ ngoài trời', () => {
  it('đường xe và dốc chỉ cho xe không dùng để đi bộ; dốc có lối đi bộ thì đi được', () => {
    const paths = createSampleSitePlan().paths;
    const ramps = paths.filter((p) => p.kind === 'ramp');
    expect(ramps.length).toBeGreaterThan(0);
    expect(paths.filter((p) => p.kind === 'vehicle').some(isWalkable)).toBe(false);
    expect(ramps.every((r) => r.walkway && isWalkable(r))).toBe(true);
    expect(ramps.map((r) => ({ ...r, walkway: undefined })).some(isWalkable)).toBe(false);
  });

  it('người đi bộ đi trên lối đi bộ cạnh lòng dốc, nối từ vỉa hè lên sảnh', () => {
    const ramp: SitePath = {
      id: 'r',
      kind: 'ramp',
      width: 4,
      walkway: 'right',
      sidewalk: 2,
      points: [
        { x: 0, y: 10 },
        { x: 0, y: 0 },
      ],
    };
    // Đi lên phía bắc (y giảm): bên phải = phía đông, tim lối đi bộ cách tim dốc 3 m.
    expect(rampWalkLines(ramp)).toEqual([
      [
        { x: 3, y: 10 },
        { x: 3, y: 0 },
      ],
    ]);
    const street: SitePath = {
      id: 's',
      kind: 'pedestrian',
      width: 2,
      points: [
        { x: -10, y: 13 },
        { x: 10, y: 13 },
      ],
    };
    const g = buildSiteWalkGraph([ramp, street], [{ key: 'lobby', position: { x: 3, y: -1 } }]);
    // Chân lối đi bộ (3, 10) nối vào lối đi phía dưới (cách 3 m).
    const foot = g.get('s:300:1000') ?? [];
    expect(foot.some((e) => e.to === 's:300:1300')).toBe(true);
  });

  it('sân / sảnh là chỗ người đi bộ: đi thẳng giữa các lối đi và cửa trong sân', () => {
    const walk = (id: string, pts: [number, number][]): SitePath => ({
      id,
      kind: 'pedestrian',
      width: 2,
      points: pts.map(([x, y]) => ({ x, y })),
    });
    // Hai lối đi cụt cùng chạm vào một sân, không nối với nhau.
    const paths = [
      walk('a', [
        [-20, 0],
        [-2, 0],
      ]),
      walk('b', [
        [2, 5],
        [2, 20],
      ]),
    ];
    const plaza = {
      id: 'p',
      kind: 'plaza' as const,
      polygon: [
        { x: -4, y: -4 },
        { x: 6, y: -4 },
        { x: 6, y: 6 },
        { x: -4, y: 6 },
      ],
    };
    const door = { key: 'door', position: { x: 6, y: 1 } };
    const without = buildSiteWalkGraph(paths, [door]);
    expect((without.get('s:-200:0') ?? []).some((e) => e.to === 's:200:500')).toBe(false);
    const g = buildSiteWalkGraph(paths, [door], {}, [plaza]);
    expect((g.get('s:-200:0') ?? []).some((e) => e.to === 's:200:500')).toBe(true);
    expect((g.get('door') ?? []).some((e) => e.to === 's:-200:0')).toBe(true);
  });

  it('chưa có lối đi thì nối thẳng các điểm', () => {
    const g = buildSiteWalkGraph(
      [],
      [
        { key: 'a', position: { x: 0, y: 0 } },
        { key: 'b', position: { x: 3, y: 4 } },
      ],
    );
    expect(g.get('a')).toEqual([expect.objectContaining({ to: 'b' })]);
  });

  it('nối chữ T và bỏ đường xe', () => {
    const g = buildSiteWalkGraph(
      [
        {
          id: 'p1',
          kind: 'pedestrian',
          width: 2,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
        },
        // Đầu lối thứ hai cách thân lối thứ nhất 0.5 m → vẫn nối.
        {
          id: 'p2',
          kind: 'pedestrian',
          width: 2,
          points: [
            { x: 5, y: 0.5 },
            { x: 5, y: 10 },
          ],
        },
        {
          id: 'road',
          kind: 'vehicle',
          width: 6,
          points: [
            { x: 0, y: 5 },
            { x: 10, y: 5 },
          ],
        },
      ],
      [
        { key: 'A', position: { x: 0, y: -1 } },
        { key: 'B', position: { x: 5, y: 11 } },
      ],
    );
    // Có đường từ A tới B (Dijkstra đơn giản bằng BFS).
    const seen = new Set(['A']);
    const queue = ['A'];
    while (queue.length) {
      for (const e of g.get(queue.shift()!) ?? []) {
        if (!seen.has(e.to)) {
          seen.add(e.to);
          queue.push(e.to);
        }
      }
    }
    expect(seen.has('B')).toBe(true);
    // Không có nút nào nằm trên đường xe (y = 5, ngoài lối p2 tại x = 5).
    expect([...g.keys()].some((k) => k.endsWith(':500') && !k.startsWith('s:500'))).toBe(false);
  });
});

describe('đường chung có vỉa hè', () => {
  const road: SitePath = {
    id: 'road',
    kind: 'shared',
    width: 10,
    sidewalk: 2,
    points: [
      { x: 0, y: 0 },
      { x: 0, y: 40 },
    ],
  };

  it('đi trên vỉa hè hai bên, qua đường ở hai đầu đường', () => {
    const g = buildSiteWalkGraph([road], []);
    const keys = [...g.keys()];
    // Tim vỉa hè cách tim đường 4 m; không có nút nào giữa lòng đường.
    expect(keys.every((k) => k.startsWith('s:-400:') || k.startsWith('s:400:'))).toBe(true);
    expect((g.get('s:-400:0') ?? []).some((e) => e.to === 's:400:0')).toBe(true);
    expect((g.get('s:-400:4000') ?? []).some((e) => e.to === 's:400:4000')).toBe(true);
  });

  it('lối đi vẽ tới mép vỉa hè hoặc tới tim đường vẫn nối được', () => {
    const toEdge: SitePath = {
      id: 'e',
      kind: 'pedestrian',
      width: 2,
      // Dừng ở mép ngoài vỉa hè phía đông (x = 5), cách tim vỉa hè 1 m.
      points: [
        { x: 20, y: 10 },
        { x: 5, y: 10 },
      ],
    };
    const toCenter: SitePath = {
      id: 'c',
      kind: 'pedestrian',
      width: 2,
      // Vẽ tới tim đường: là chỗ qua đường, nối sang vỉa hè cả hai bên.
      points: [
        { x: -20, y: 30 },
        { x: 0, y: 30 },
      ],
    };
    const g = buildSiteWalkGraph([road, toEdge, toCenter], []);
    expect((g.get('s:500:1000') ?? []).some((e) => e.to === 's:400:1000')).toBe(true);
    const center = (g.get('s:0:3000') ?? []).map((e) => e.to);
    expect(center).toEqual(expect.arrayContaining(['s:-400:3000', 's:400:3000']));
  });
});

describe('chỉ đường liên toà', () => {
  it('từ toà chính sang phòng ở Khu B: ra cửa chính → đi bộ ngoài trời → vào Khu B', () => {
    const { campus, buildings } = setup();
    const route = findCampusRoute(
      campus,
      buildings,
      { buildingId: SAMPLE_BUILDING_ID, floorId: 'floor_1', position: { x: 20, y: 10 } },
      { buildingId: SAMPLE_ANNEX_ID, roomId: 'b_floor_1_room_bot1' },
    )!;
    expect(kinds(route)).toEqual(['indoor', 'outdoor', 'indoor']);
    const types = route.steps.map((s) => s.type);
    expect(types).toContain('exit-building');
    expect(types).toContain('enter-building');
    expect(types[types.length - 1]).toBe('arrive');
    expect(types.filter((t) => t === 'start')).toHaveLength(1);
    // Đi theo hành lang có mái che (x = -4) giữa hai cửa chính.
    const outdoor = route.legs[1]!;
    expect(outdoor.kind === 'outdoor' && outdoor.path.some((p) => p.x === -4)).toBe(true);
    expect(route.distance).toBeGreaterThan(35);
    expect(route.destinationName).toContain('B.105');
  });

  it('cùng toà thì chỉ đi trong nhà', () => {
    const { campus, buildings } = setup();
    const route = findCampusRoute(
      campus,
      buildings,
      { buildingId: SAMPLE_BUILDING_ID, floorId: 'floor_1', position: { x: 20, y: 10 } },
      { buildingId: SAMPLE_BUILDING_ID, roomId: 'floor_1_room_top0' },
    )!;
    expect(kinds(route)).toEqual(['indoor']);
  });

  it('tới điểm ngoài trời (ATM) và xuất phát từ cổng', () => {
    const { campus, buildings } = setup();
    const toAtm = findCampusRoute(
      campus,
      buildings,
      { buildingId: SAMPLE_BUILDING_ID, floorId: 'floor_1', position: { x: 20, y: 10 } },
      { poiId: 'poi_atm' },
    )!;
    expect(kinds(toAtm)).toEqual(['indoor', 'outdoor']);
    expect(toAtm.steps[toAtm.steps.length - 1]).toMatchObject({
      type: 'arrive',
      text: 'Đến Cây ATM ngoài trời',
    });

    const fromGate = findCampusRoute(
      campus,
      buildings,
      { site: { x: -9, y: 75 } },
      { buildingId: SAMPLE_ANNEX_ID, roomId: 'b_floor_1_room_top0' },
    )!;
    expect(kinds(fromGate)).toEqual(['outdoor', 'indoor']);
    expect(fromGate.steps[0]!.type).toBe('start');
  });

  it('từ bãi xe vào sảnh: đi thẳng qua mặt lát nối, không đi trên lòng dốc', () => {
    const { campus, buildings } = setup();
    const route = findCampusRoute(
      campus,
      buildings,
      { site: { x: -24, y: 27.5 } },
      { buildingId: SAMPLE_BUILDING_ID, floorId: 'floor_1', position: { x: 5, y: 10 } },
    )!;
    expect(kinds(route)).toEqual(['outdoor', 'indoor']);
    const leg = route.legs[0] as Extract<CampusRoute['legs'][number], { kind: 'outdoor' }>;
    // Ngắn hơn lối vòng cũ theo lối có mái che (~39 m tới cửa chính).
    expect(leg.distance).toBeLessThan(36);
    const site = campus.site!;
    const ramps = site.paths.filter((p) => p.kind === 'ramp');
    for (let i = 0; i + 1 < leg.path.length; i++) {
      const a = leg.path[i]!;
      const b = leg.path[i + 1]!;
      const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.25);
      for (let k = 0; k <= n; k++) {
        const p = { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n };
        for (const r of ramps) {
          const line = rampCenterline(r, site.paths);
          const d = Math.min(
            ...line.slice(1).map((q, j) => projectPointOnSegment(p, line[j]!, q).distance),
          );
          expect(d).toBeGreaterThan(r.width / 2);
        }
      }
    }
  });

  it('đi qua cầu nối tầng 2 thay vì xuống đất', () => {
    const { campus, buildings } = setup();
    const withLink: Campus = {
      ...campus,
      links: [
        {
          id: 'bridge',
          name: 'Cầu nối tầng 2',
          kind: 'bridge',
          // Hai cửa phòng phía nam tầng 2 (dùng làm đầu cầu cho bài test).
          a: { buildingId: SAMPLE_BUILDING_ID, floorId: 'floor_2', openingId: 'floor_2_door_bot1' },
          b: {
            buildingId: SAMPLE_ANNEX_ID,
            floorId: 'b_floor_2',
            openingId: 'b_floor_2_door_top1',
          },
          accessible: true,
          covered: true,
        },
      ],
    };
    const from = {
      buildingId: SAMPLE_BUILDING_ID,
      floorId: 'floor_2',
      position: { x: 20, y: 10 },
    };
    const to = { buildingId: SAMPLE_ANNEX_ID, floorId: 'b_floor_2', position: { x: 20, y: 10 } };
    const route = findCampusRoute(withLink, buildings, from, to)!;
    expect(kinds(route)).toContain('link');
    expect(kinds(route)).not.toContain('outdoor');
    expect(route.steps.some((s) => s.type === 'take-link')).toBe(true);

    // Cửa đầu cầu chưa có trên đồ thị đi lại (chưa tạo lại đồ thị) → vẫn đi qua cầu.
    const stripped = new Map(buildings);
    const annex = buildings.get(SAMPLE_ANNEX_ID)!;
    stripped.set(SAMPLE_ANNEX_ID, {
      ...annex,
      floors: annex.floors.map((f) => ({
        ...f,
        navGraph: {
          ...f.navGraph,
          nodes: f.navGraph.nodes.filter((n) => n.refId !== 'b_floor_2_door_top1'),
        },
      })),
    });
    expect(kinds(findCampusRoute(withLink, stripped, from, to)!)).toContain('link');

    // Cầu không dành cho xe lăn → chế độ xe lăn đi đường khác.
    withLink.links![0]!.accessible = false;
    const wheelchair = findCampusRoute(withLink, buildings, from, to, { accessibleOnly: true })!;
    expect(kinds(wheelchair)).not.toContain('link');
  });

  it('đổi sang toạ độ mặt bằng tổng thể theo tầng chung', () => {
    const { campus, buildings } = setup();
    const route = findCampusRoute(
      campus,
      buildings,
      { buildingId: SAMPLE_BUILDING_ID, floorId: 'floor_2', position: { x: 20, y: 10 } },
      { buildingId: SAMPLE_ANNEX_ID, roomId: 'b_floor_1_room_bot1' },
    )!;
    const site = campusRouteToSiteRoute(route, campus, buildings);
    expect(site.segments.map((s) => s.floorId)).toEqual(['L2', 'L1']);
    expect(site.segments[0]!.transition?.toFloorId).toBe('L1');
    // Khu B đặt tại y = 35 → điểm cuối nằm trong Khu B trên mặt bằng.
    expect(site.to.position.y).toBeGreaterThan(35);
    expect(site.entry?.floorId).toBe('L1');
    expect(site.instructions.every((i) => levelOfFloorId(i.floorId) !== null)).toBe(true);
  });
});
