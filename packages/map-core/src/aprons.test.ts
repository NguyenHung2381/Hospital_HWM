import { describe, expect, it } from 'vitest';
import { siteAprons, type SiteApron } from './aprons';
import {
  buildingFootprint,
  placedFootprint,
  rampCenterline,
  sidewalkWidth,
  type SiteArea,
  type SitePath,
} from './campus';
import { boundsOf, pointInPolygon, projectPointOnSegment } from './geometry';
import {
  createSampleAnnex,
  createSampleBuilding,
  createSampleCampus,
  createSampleSitePlan,
} from './sample';
import type { Point } from './types';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const walk = (id: string, pts: [number, number][], width = 2): SitePath => ({
  id,
  kind: 'pedestrian',
  width,
  points: pts.map(([x, y]) => ({ x, y })),
});
const distTo = (p: Point, line: readonly Point[]) =>
  Math.min(...line.slice(1).map((b, i) => projectPointOnSegment(p, line[i]!, b).distance));
/** Các điểm lưới (bước `step`) nằm trong đa giác. */
const samples = (polygon: readonly Point[], step = 0.25) => {
  const b = boundsOf(polygon)!;
  const out: Point[] = [];
  for (let x = b.minX + step / 2; x < b.maxX; x += step) {
    for (let y = b.minY + step / 2; y < b.maxY; y += step) {
      if (pointInPolygon({ x, y }, polygon)) out.push({ x, y });
    }
  }
  return out;
};

describe('mặt lát nối quanh sảnh', () => {
  const sample = () => {
    const campus = createSampleCampus();
    const buildings = [createSampleBuilding(), createSampleAnnex()];
    const footprints = campus.buildings.map((pl) =>
      placedFootprint(pl, buildingFootprint(buildings.find((b) => b.id === pl.buildingId)!)),
    );
    const site = createSampleSitePlan();
    return { site, footprints, aprons: siteAprons(site, footprints) };
  };

  it('lấp khoảng hở giữa sảnh, lối đi bộ trên dốc, vỉa hè và các lối đi (dữ liệu mẫu)', () => {
    const { aprons } = sample();
    const covers = (p: Point) => aprons.some((a) => pointInPolygon(p, a.polygon));
    // Dưới sảnh Khám bệnh: giữa lối đi bộ trên dốc, vỉa hè, lối có mái che và lối từ bãi xe.
    expect(covers({ x: -8, y: 22 })).toBe(true);
    // Giữa hai sảnh, phía tây lối có mái che.
    expect(covers({ x: -8, y: 33 })).toBe(true);
    // Dưới sảnh Cấp cứu: giữa lối đi bộ trên dốc, lối từ cổng và đường vòng phía nam.
    expect(covers({ x: -7, y: 56 })).toBe(true);
    // Phía đông lối có mái che thông ra sân vườn → không phải khoảng hở bị bao kín.
    expect(covers({ x: -1, y: 22 })).toBe(false);
    // Khe giữa hàng rào và đường công cộng bị hàng rào ngăn với sân trước cổng → không lấp.
    expect(covers({ x: -8, y: 80 })).toBe(false);
    for (const a of aprons) expect(a.area).toBeLessThanOrEqual(200);
  });

  it('không lát lên lòng đường, lòng dốc, làn đón trả hay toà nhà', () => {
    const { site, footprints, aprons } = sample();
    const pts = aprons.flatMap((a) => samples(a.polygon));
    expect(pts.length).toBeGreaterThan(100);
    const cell = 0.2;
    for (const p of pts) {
      for (const path of site.paths) {
        if (path.kind === 'ramp') {
          expect(distTo(p, rampCenterline(path, site.paths))).toBeGreaterThan(
            path.width / 2 - cell,
          );
        } else if (path.kind === 'vehicle' || path.kind === 'shared') {
          expect(distTo(p, path.points)).toBeGreaterThan(
            path.width / 2 - sidewalkWidth(path) - cell,
          );
        }
      }
      for (const fp of footprints) expect(pointInPolygon(p, fp)).toBe(false);
      for (const area of site.areas) {
        if (area.kind === 'dropoff') expect(pointInPolygon(p, area.polygon)).toBe(false);
      }
    }
  });

  const plaza: SiteArea = { id: 'p', kind: 'plaza', polygon: rect(0, 0, 10, 10) };
  /** Khung lối đi bao một ô 6 x 6 m ngay dưới sân. */
  const frame = [
    walk('l', [
      [0, 10],
      [0, 18],
    ]),
    walk('r', [
      [10, 10],
      [10, 18],
    ]),
    walk('b', [
      [0, 18],
      [10, 18],
    ]),
  ];

  const covering = (aprons: readonly SiteApron[], p: Point) =>
    aprons.filter((a) => pointInPolygon(p, a.polygon));

  it('chỉ lấp khoảng hở bị bao kín', () => {
    const closed = siteAprons({ areas: [plaza], paths: frame });
    const gap = covering(closed, { x: 5, y: 14 });
    expect(gap).toHaveLength(1);
    expect(gap[0]!.plazaId).toBe('p');
    // Lấn sang lối đi và sân bên cạnh để phủ kín mép.
    expect(pointInPolygon({ x: 1.1, y: 14 }, gap[0]!.polygon)).toBe(true);
    expect(pointInPolygon({ x: 5, y: 9.9 }, gap[0]!.polygon)).toBe(true);

    const open = siteAprons({ areas: [plaza], paths: frame.slice(0, 2) });
    for (const p of [
      { x: 5, y: 14 },
      { x: 5, y: 11 },
    ]) {
      expect(covering(open, p)).toEqual([]);
    }
  });

  it('bo góc chỗ lối đi chạm sân, kể cả khi khoảng hở thông ra ngoài', () => {
    // Lối đi thẳng góc vào giữa mép dưới của sân: hai góc vuông ở (4, 10) và (6, 10).
    const site = {
      areas: [plaza],
      paths: [
        walk('w', [
          [5, 20],
          [5, 8],
        ]),
      ],
    };
    const aprons = siteAprons(site);
    // Sát góc: được lấp (bo cung tròn bán kính 3 m, tâm (1, 13) và (9, 13)).
    expect(covering(aprons, { x: 3.6, y: 10.4 })).toHaveLength(1);
    expect(covering(aprons, { x: 6.4, y: 10.4 })).toHaveLength(1);
    // Ngoài cung bo: để trống.
    expect(covering(aprons, { x: 2, y: 11 })).toEqual([]);
    expect(covering(aprons, { x: 8, y: 11 })).toEqual([]);
    expect(covering(aprons, { x: 3.5, y: 13 })).toEqual([]);
    // Không bo: không lấp gì.
    expect(siteAprons(site, [], { round: 0 })).toEqual([]);
  });

  it('không lấp khoảng hở quá lớn, ở xa sân hoặc bị hàng rào ngăn với sân', () => {
    const big = siteAprons({ areas: [plaza], paths: frame }, [], { maxArea: 30 });
    expect(covering(big, { x: 5, y: 14 })).toEqual([]);
    const fence: SitePath = {
      id: 'f',
      kind: 'fence',
      width: 0.3,
      // Cắt ngang cả hai lối đi (không có cổng).
      points: [
        { x: -2, y: 11.5 },
        { x: 12, y: 11.5 },
      ],
    };
    // Phần dưới hàng rào bị ngăn với sân; phần trên (giữa sân và hàng rào) vẫn được lấp.
    const fenced = siteAprons({ areas: [plaza], paths: [...frame, fence] });
    expect(fenced.some((a) => pointInPolygon({ x: 5, y: 15 }, a.polygon))).toBe(false);
    expect(fenced.some((a) => pointInPolygon({ x: 5, y: 10.8 }, a.polygon))).toBe(true);
  });
});
