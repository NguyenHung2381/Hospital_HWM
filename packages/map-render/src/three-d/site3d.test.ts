import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RAMP_RISE,
  emptySitePlan,
  pointInPolygon,
  withLobbyParts,
  type Point,
  type SitePath,
} from '@hwn/map-core';
import { createSampleSitePlan } from '@hwn/map-core/sample';
import { buildSiteMeshes, outsidePieces, trimStart } from './site3d';

const line: Point[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
];
/** Vùng x < 4 (vd. lòng đường). */
const left = (p: Point) => p.x < 4;

describe('cắt đường gấp khúc theo vùng', () => {
  it('outsidePieces: giữ phần ngoài vùng, cắt đúng mép vùng', () => {
    const pieces = outsidePieces(line, left);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]![0]!.x).toBeCloseTo(4, 1);
    expect(pieces[0]!.slice(-2)).toEqual([
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(outsidePieces(line, () => true)).toEqual([]);
  });

  it('trimStart: chỉ bỏ phần đầu nằm trong vùng, giữ nguyên các đỉnh phía sau', () => {
    const rest = trimStart(line, left);
    expect(rest[0]!.x).toBeCloseTo(4, 1);
    expect(rest.slice(1)).toEqual([line[1], line[2]]);
    // Đầu đường không nằm trong vùng → giữ nguyên (kể cả khi đoạn sau đi vào vùng).
    expect(trimStart(line, (p) => p.y > 5)).toEqual(line);
    expect(trimStart(line, () => true)).toEqual([]);
  });
});

describe('dựng 3D phần ngoài trời (dữ liệu mẫu)', () => {
  const site = createSampleSitePlan();
  const meshes = buildSiteMeshes(site, {
    area: () => '#000000',
    edge: (p: SitePath) => (p.kind === 'ramp' || p.use || p.vehicles ? '#2563eb' : null),
    rampLabel: () => '',
  });
  /** Đỉnh (x, cao độ, y) của các geometry. */
  const vertices = (gs: ({ getAttribute(n: 'position'): { array: ArrayLike<number> } } | null)[]) =>
    gs.flatMap((g) => {
      if (!g) return [];
      const a = g.getAttribute('position').array;
      const out: { x: number; h: number; y: number }[] = [];
      for (let i = 0; i < a.length; i += 3) out.push({ x: a[i]!, h: a[i + 1]!, y: a[i + 2]! });
      return out;
    });
  const road = site.paths.find((p) => p.id === 'site_road_west')!;
  /** Trong lòng đường nội bộ (tim x = −16, lòng đường rộng 7 m), chừa 2 cm ở mép. */
  const inMainRoad = (v: { x: number; y: number }) =>
    Math.abs(v.x - road.points[0]!.x) < 3.5 - 0.02 && v.y > -24 && v.y < 83;

  it('chân dốc và viền màu không nhô lên khỏi mặt đường trong lòng đường', () => {
    const vs = vertices([...meshes.edges.map((e) => e.geometry), meshes.rampSides]);
    const inside = vs.filter(inMainRoad);
    expect(inside.length).toBeGreaterThan(0);
    // Mặt nhựa lòng đường ở cao độ 0.1 m.
    for (const v of inside) expect(v.h).toBeLessThan(0.1);
    // Đỉnh dốc vẫn lên tới mặt sảnh (bệ 0.45 m).
    const ramps = vertices(meshes.edges.map((e) => e.geometry));
    expect(Math.max(...ramps.map((v) => v.h))).toBeGreaterThan(0.5);
  });

  it('viền màu của đường nhánh không lấn vào bãi xe', () => {
    const lots = site.areas.filter((a) => a.kind === 'parking' || a.kind === 'bike_parking');
    const vs = vertices(meshes.edges.map((e) => e.geometry));
    for (const v of vs) {
      for (const lot of lots) {
        const deep = [
          { x: v.x - 0.05, y: v.y },
          { x: v.x + 0.05, y: v.y },
          { x: v.x, y: v.y - 0.05 },
          { x: v.x, y: v.y + 0.05 },
        ].every((q) => pointInPolygon(q, lot.polygon));
        expect(deep).toBe(false);
      }
    }
  });

  it('có vạch qua đường, nằm sát trên mặt đường / mặt dốc', () => {
    const vs = vertices([meshes.zebras]);
    expect(vs.length).toBeGreaterThan(0);
    for (const v of vs) {
      expect(v.h).toBeGreaterThan(0.1);
      expect(v.h).toBeLessThan(0.6);
    }
  });
});

describe('dựng 3D bậc thang và mặt dốc của sảnh', () => {
  const site = withLobbyParts({
    ...emptySitePlan(),
    lobbies: [
      {
        id: 'L',
        position: { x: 0, y: 0 },
        outward: { x: 0, y: 1 },
        width: 10,
        depth: 6,
        edges: { front: { kind: 'steps' }, left: { kind: 'ramp' } },
      },
    ],
  });
  const meshes = buildSiteMeshes(site, {
    area: () => '#000000',
    edge: () => null,
    rampLabel: () => '',
  });
  const heights = (g: { getAttribute(n: 'position'): { array: ArrayLike<number> } } | null) => {
    const a = g!.getAttribute('position').array;
    const out: { x: number; h: number; y: number }[] = [];
    for (let i = 0; i < a.length; i += 3) out.push({ x: a[i]!, h: a[i + 1]!, y: a[i + 2]! });
    return out;
  };

  it('bậc thang: các khối bậc cao dần tới đúng cao bệ sảnh ở mép sảnh', () => {
    const steps = heights(meshes.plinths).filter((v) => v.y > 6.01);
    const top = Math.max(...steps.map((v) => v.h));
    expect(top).toBeCloseTo(DEFAULT_RAMP_RISE);
    // Ở chân bậc (y gần 7.05) chỉ cao một bậc.
    const foot = steps.filter((v) => v.y > 6.9).map((v) => v.h);
    expect(Math.max(...foot)).toBeCloseTo(DEFAULT_RAMP_RISE / 3);
  });

  it('mặt dốc: nghiêng từ mặt đất (chân) lên cao bệ (đỉnh)', () => {
    const deck = heights(meshes.paving).filter((v) => v.x > 4.5);
    const far = deck.filter((v) => v.x > 10).map((v) => v.h);
    const near = deck.filter((v) => v.x < 5.2).map((v) => v.h);
    expect(Math.max(...far)).toBeLessThan(0.1);
    expect(Math.max(...near)).toBeGreaterThan(DEFAULT_RAMP_RISE - 0.05);
  });
});
