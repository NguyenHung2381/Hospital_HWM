import { describe, expect, it } from 'vitest';
import type { SiteLobby, SitePath, SitePlan } from './campus';
import { exteriorSockets } from './exterior';
import {
  lobbyExterior,
  lobbyParts,
  lobbyPolygon,
  mergeLobbies,
  stepsFor,
  slopeRun,
  withLobbyParts,
} from './lobby';
import type { Point } from './types';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** Sảnh 10 × 6 m trước bức tường y = 0, nhìn ra phía nam (+y): bên trái là +x. */
const base: SiteLobby = {
  id: 'L',
  name: 'Sảnh A',
  position: { x: 0, y: 0 },
  outward: { x: 0, y: 1 },
  width: 10,
  depth: 6,
};
const part = (l: SiteLobby, key: string) => lobbyParts(l).paths.find((p) => p.id === `L~${key}`);

describe('sảnh một đối tượng', () => {
  it('bệ sảnh hình chữ nhật sát tường; không có cạnh nào thì chỉ có bệ', () => {
    const parts = lobbyParts(base);
    expect(parts.paths).toEqual([]);
    expect(parts.areas).toHaveLength(1);
    expect(parts.areas[0]!).toMatchObject({ id: 'L~lobby', kind: 'plaza', name: 'Sảnh A' });
    expect(lobbyPolygon(base)).toEqual([
      { x: -5, y: 0 },
      { x: -5, y: 6 },
      { x: 5, y: 6 },
      { x: 5, y: 0 },
    ]);
  });

  it('bậc thang cả cạnh trước: từ chân bậc lên mép sảnh, rộng cả cạnh, xe lăn không đi được', () => {
    const l = { ...base, edges: { front: { kind: 'steps' as const } } };
    const steps = part(l, 'steps_front')!;
    const { count, run } = stepsFor(0.45);
    expect(count).toBe(3);
    expect(steps.kind).toBe('steps');
    expect(steps.width).toBe(10);
    expect(steps.accessible).toBe(false);
    expect(steps.points[0]).toEqual({ x: 0, y: 6 + run });
    // Đỉnh lấn nhẹ vào bệ sảnh để liền với sảnh.
    expect(steps.points[1]!.y).toBeLessThan(6);
  });

  it('cạnh trái là mặt dốc thoải 1:12 rộng cả cạnh', () => {
    const l = { ...base, edges: { left: { kind: 'ramp' as const } } };
    const slope = part(l, 'slope_left')!;
    expect(slope.kind).toBe('slope');
    expect(slope.width).toBe(6);
    expect(slope.points[0]).toEqual({ x: 5 + slopeRun(0.45), y: 3 });
    expect(slope.accessible).toBeUndefined();
  });

  it('bậc + dốc: dốc xe lăn ở đầu đã chọn, bậc thang phần còn lại', () => {
    // Cạnh phải (x = −5) nhìn ra phía tây: bên trái là phía trước sảnh (+y).
    const l = {
      ...base,
      edges: { right: { kind: 'steps_ramp' as const, rampAt: 'left' as const } },
    };
    const slope = part(l, 'slope_right')!;
    const steps = part(l, 'steps_right')!;
    expect(slope.width).toBe(1.5);
    expect(steps.width).toBe(4.5);
    expect(slope.points[1]!.y).toBeCloseTo(5.25);
    expect(steps.points[1]!.y).toBeCloseTo(2.25);
    expect(slope.points[0]!.x).toBeCloseTo(-5 - slopeRun(0.45));
  });

  it('đón / trả ô tô: làn đón chạy trên mặt sảnh; bậc cạnh trước ở mép ngoài chỗ xe dừng, giữa 2 dốc', () => {
    const l: SiteLobby = {
      ...base,
      width: 14,
      depth: 7,
      use: 'outpatient',
      dropoff: { walkway: true },
      edges: { front: { kind: 'steps' }, left: { kind: 'steps' } },
    };
    const parts = lobbyParts(l);
    const ref = lobbyExterior({
      door: base.position,
      outward: base.outward,
      width: 14,
      depth: 7,
      id: (k) => `L~${k}`,
    });
    for (const r of ref.paths) {
      expect(parts.paths.find((p) => p.id === r.id)?.points).toEqual(r.points);
    }
    // Mép ngoài làn đón ở y = 7 + 3.5; bậc dài bằng làn đón (giữa hai đầu dốc).
    const lane = parts.paths.find((p) => p.id === 'L~lane')!;
    const front = part(l, 'steps_front')!;
    expect(front.points[0]).toEqual({ x: 0, y: 10.5 + stepsFor(0.45).run });
    // Dãy bậc lấp kín khoảng giữa hai dốc: rộng hơn làn đón, không lấn vào lòng dốc.
    expect(front.width).toBeGreaterThan(Math.abs(lane.points[0]!.x - lane.points[1]!.x));
    expect(front.width).toBeLessThanOrEqual(14);
    // Sảnh là điểm đón / trả: một bệ sảnh phủ cả làn đón (sâu 7 + 3.5 m), không có khu kẻ vạch riêng.
    expect(parts.areas.map((a) => a.kind)).toEqual(['plaza']);
    expect(Math.max(...parts.areas[0]!.polygon.map((p) => p.y))).toBe(10.5);
    expect(parts.paths.some((p) => p.id.includes('cross'))).toBe(false);
    expect(part(l, 'steps_left')).toBeDefined();
    expect(parts.paths.find((p) => p.id === 'L~ramp_up')?.use).toBe('outpatient');
  });

  it('dốc ô tô thẳng: đi vuông góc ra đường, bo tròn nhập vào đầu làn đón', () => {
    const l: SiteLobby = { ...base, width: 14, depth: 7, dropoff: { shape: 'straight' } };
    const lane = part(l, 'lane')!;
    for (const key of ['ramp_up', 'ramp_down']) {
      const ramp = part(l, key)!;
      const [foot, next] = ramp.points as [Point, Point];
      const end = ramp.points.at(-1)!;
      // Đoạn đầu vuông góc với tường (tường y = 0): chỉ đổi y.
      expect(next.x).toBeCloseTo(foot.x);
      expect(foot.y).toBeCloseTo(7 + 3.5 + 3.25);
      // Nhập đúng đầu làn đón; chân dốc lệch ra ngoài đầu làn một bán kính bo.
      expect(lane.points.some((q) => q.x === end.x && q.y === end.y)).toBe(true);
      expect(Math.abs(foot.x)).toBeGreaterThan(Math.abs(end.x));
      expect(Math.abs(foot.x) - Math.abs(end.x)).toBeLessThanOrEqual(3);
    }
  });

  it('bậc trước sảnh lấp kín khoảng giữa hai dốc với mọi hình dốc', () => {
    const front = (shape: 'curve' | 'straight' | 'inline') =>
      part(
        { ...base, width: 14, depth: 7, dropoff: { shape }, edges: { front: { kind: 'steps' } } },
        'steps_front',
      )!.width;
    // Dốc thẳng vuông góc: mép trong lòng dốc cách tâm 4.5 + 3 (bo) − 1.75 = 5.75 m.
    expect(front('straight')).toBeCloseTo(11.5, 0);
    // Dốc thẳng 180° chạy trong sảnh, không chạm mép trước: bậc rộng cả sảnh.
    expect(front('inline')).toBe(14);
    expect(front('curve')).toBeGreaterThan(9);
  });

  it('dốc thẳng 180°: nối dài làn đón dọc tường, chân dốc ở hai bên sảnh', () => {
    const l: SiteLobby = { ...base, width: 14, depth: 7, dropoff: { shape: 'inline', spread: 15 } };
    const lane = part(l, 'lane')!;
    for (const [key, sign] of [
      ['ramp_up', 1],
      ['ramp_down', -1],
    ] as const) {
      const ramp = part(l, key)!;
      expect(ramp.points).toHaveLength(2);
      // Cùng tim với làn đón (y = 7 + 1.75), chân dốc cách tâm 15 m.
      expect(ramp.points.every((p) => p.y === lane.points[0]!.y)).toBe(true);
      expect(ramp.points[0]!.x).toBe(sign * 15);
    }
  });

  it('cao bệ đổi thì số bậc, chiều dài dốc và cao độ bệ đổi theo', () => {
    const l = { ...base, rise: 0.9, edges: { front: { kind: 'ramp' as const } } };
    const slope = part(l, 'slope_front')!;
    expect(slope.rise).toBe(0.9);
    expect(slope.points[0]!.y).toBeCloseTo(6 + 0.9 * 12);
    expect(lobbyParts(l).areas[0]!.rise).toBe(0.9);
    expect(stepsFor(0.9).count).toBe(6);
  });

  it('ghép các phần vào mặt bằng (bỏ `lobbies`), lưu đệm; không có sảnh thì giữ nguyên', () => {
    const plan: Pick<SitePlan, 'areas' | 'paths' | 'lobbies'> = {
      areas: [],
      paths: [],
      lobbies: [{ ...base, edges: { front: { kind: 'steps' as const } } }],
    };
    const full = withLobbyParts(plan);
    expect('lobbies' in full).toBe(false);
    expect(full.areas.map((a) => a.id)).toEqual(['L~lobby']);
    expect(full.paths.map((p) => p.id)).toEqual(['L~steps_front']);
    expect(withLobbyParts(plan)).toBe(full);
    const empty = { areas: [], paths: [] };
    expect(withLobbyParts(empty)).toBe(empty);
  });

  it('chân bậc thang là đầu nối lối đi bộ (rộng như lối đi bộ), đỉnh nằm trong sảnh thì không', () => {
    const ext = {
      areas: [],
      paths: [],
      lobbies: [{ ...base, edges: { front: { kind: 'steps' as const } } }],
    };
    const sockets = exteriorSockets(ext, rect(-20, -10, 20, 0));
    expect(sockets.map((s) => s.id)).toEqual(['L~steps_front:start']);
    expect(sockets[0]!.kind).toBe('walk');
    expect(sockets[0]!.width).toBeLessThanOrEqual(3);
    expect(sockets[0]!.dir.y).toBeGreaterThan(0.9);
  });
});

describe('gộp sảnh kiểu cũ', () => {
  // Toà 40 × 20 m, cửa chính giữa tường tây (x = 0).
  const footprint = rect(0, 0, 40, 20);
  const old = lobbyExterior({
    door: { x: 0, y: 10 },
    outward: { x: -1, y: 0 },
    use: 'emergency',
    name: 'Sảnh Cấp cứu',
    title: 'Cấp cứu',
    id: (k) => `old_${k}`,
  });

  it('cụm sảnh đón chưa sửa tay → một sảnh có làn đón, dựng lại đúng hình cũ', () => {
    const merged = mergeLobbies(old, footprint);
    expect(merged.areas).toEqual([]);
    expect(merged.paths).toEqual([]);
    expect(merged.lobbies).toHaveLength(1);
    const lobby = merged.lobbies![0]!;
    expect(lobby).toMatchObject({
      id: 'old_lobby',
      name: 'Sảnh Cấp cứu',
      use: 'emergency',
      width: 14,
      depth: 7,
      dropoff: { walkway: true },
    });
    const parts = lobbyParts(lobby);
    for (const key of ['lane', 'ramp_up', 'ramp_down']) {
      const before = old.paths.find((p) => p.id === `old_${key}`)!;
      const after = parts.paths.find((p) => p.id === `old_lobby~${key}`)!;
      after.points.forEach((p, i) => {
        expect(p.x).toBeCloseTo(before.points[i]!.x, 1);
        expect(p.y).toBeCloseTo(before.points[i]!.y, 1);
      });
    }
  });

  it('dốc đã sửa tay: giữ dốc / làn rời, chỉ sảnh sát tường thành sảnh một đối tượng', () => {
    const edited = {
      ...old,
      paths: old.paths.map((p): SitePath =>
        p.id === 'old_ramp_up' ? { ...p, points: [{ x: -20, y: 30 }, ...p.points.slice(1)] } : p,
      ),
    };
    const merged = mergeLobbies(edited, footprint);
    expect(merged.lobbies).toHaveLength(1);
    expect(merged.lobbies![0]!.dropoff).toBeUndefined();
    expect(merged.areas.map((a) => a.id)).toEqual(['old_dropoff']);
    expect(merged.paths).toHaveLength(3);
  });

  it('sân không sát tường toà thì giữ nguyên', () => {
    const ext = {
      areas: [{ id: 'p', kind: 'plaza' as const, polygon: rect(-30, 0, -20, 5) }],
      paths: [],
    };
    expect(mergeLobbies(ext, footprint)).toBe(ext);
  });
});
