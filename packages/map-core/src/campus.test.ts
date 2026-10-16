import { describe, expect, it } from 'vitest';
import {
  buildingFootprint,
  campusBounds,
  convexHull,
  externalMapUrl,
  fromSite,
  nextPlacementPosition,
  polygonsOverlap,
  rotatePlacement,
  toSite,
  validateCampus,
  type BuildingPlacement,
  type Campus,
  isGateOpen,
  parseClock,
} from './campus';
import { createSampleBuilding, createSampleSitePlan } from './sample';

const square = (x: number, y: number, s: number) => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];

const campus = (buildings: BuildingPlacement[]): Campus => ({
  id: 'c',
  name: 'Cơ sở chính',
  buildings,
  version: 1,
  updatedAt: '',
});

describe('mặt bằng tổng thể', () => {
  it('bao lồi bỏ điểm bên trong và điểm thẳng hàng', () => {
    const hull = convexHull([...square(0, 0, 4), { x: 2, y: 2 }, { x: 2, y: 0 }]);
    expect(hull).toHaveLength(4);
    expect(hull).toEqual(expect.arrayContaining(square(0, 0, 4)));
  });

  it('đường bao toà mẫu là hình chữ nhật 40 x 20', () => {
    const fp = buildingFootprint(createSampleBuilding());
    const xs = fp.map((p) => p.x);
    const ys = fp.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(0);
    expect(Math.max(...xs)).toBeCloseTo(40);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(20);
  });

  it('đổi toạ độ toà ↔ mặt bằng (xoay theo chiều kim đồng hồ)', () => {
    const pl: BuildingPlacement = { buildingId: 'b', position: { x: 100, y: 50 }, rotation: 90 };
    const site = toSite(pl, { x: 10, y: 0 });
    expect(site.x).toBeCloseTo(100);
    expect(site.y).toBeCloseTo(60);
    const back = fromSite(pl, site);
    expect(back.x).toBeCloseTo(10);
    expect(back.y).toBeCloseTo(0);
  });

  it('xoay quanh tâm giữ nguyên vị trí tâm trên mặt bằng', () => {
    const pl: BuildingPlacement = { buildingId: 'b', position: { x: 5, y: 5 }, rotation: 0 };
    const pivot = { x: 20, y: 10 };
    const before = toSite(pl, pivot);
    const rotated = rotatePlacement(pl, pivot, 450);
    expect(rotated.rotation).toBe(90);
    const after = toSite(rotated, pivot);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('đặt toà mới bên phải các toà đã có', () => {
    const fps = new Map([['a', square(0, 0, 10)]]);
    const c = campus([{ buildingId: 'a', position: { x: 0, y: 0 }, rotation: 0 }]);
    expect(campusBounds(c, fps)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(nextPlacementPosition(c, fps)).toEqual({ x: 20, y: 0 });
    expect(nextPlacementPosition(campus([]), fps)).toEqual({ x: 0, y: 0 });
  });

  it('phát hiện đa giác chồng nhau, kể cả nằm gọn bên trong', () => {
    expect(polygonsOverlap(square(0, 0, 10), square(5, 5, 10))).toBe(true);
    expect(polygonsOverlap(square(0, 0, 10), square(2, 2, 3))).toBe(true);
    expect(polygonsOverlap(square(0, 0, 10), square(20, 0, 5))).toBe(false);
  });

  it('kiểm tra cơ sở: tên, toà lạ, toà trùng, GPS, chồng lấn', () => {
    const info = new Map([
      ['a', { name: 'A', footprint: square(0, 0, 10) }],
      ['b', { name: 'B', footprint: square(0, 0, 10) }],
    ]);
    const ok = validateCampus(
      campus([
        { buildingId: 'a', position: { x: 0, y: 0 }, rotation: 0 },
        { buildingId: 'b', position: { x: 20, y: 0 }, rotation: 0 },
      ]),
      info,
    );
    expect(ok).toEqual({ valid: true, issues: [] });

    const bad = validateCampus(
      {
        ...campus([
          { buildingId: 'a', position: { x: 0, y: 0 }, rotation: 0 },
          { buildingId: 'b', position: { x: 5, y: 5 }, rotation: 0 },
          { buildingId: 'a', position: { x: 50, y: 0 }, rotation: 0 },
          { buildingId: 'zz', position: { x: 0, y: 0 }, rotation: 0 },
        ]),
        name: ' ',
        geo: { lat: 200, lng: 0 },
      },
      info,
    );
    expect(bad.valid).toBe(false);
    expect(bad.issues.map((i) => i.code).sort()).toEqual([
      'BUILDINGS_OVERLAP',
      'DUPLICATE_BUILDING',
      'EMPTY_NAME',
      'INVALID_GEO',
      'UNKNOWN_BUILDING',
    ]);
  });

  it('liên kết bản đồ ngoài ưu tiên toạ độ GPS', () => {
    expect(externalMapUrl({ name: 'A', geo: { lat: 10.5, lng: 106.7 } })).toContain(
      'query=10.5%2C106.7',
    );
    expect(externalMapUrl({ name: 'A', address: 'Q1' })).toContain('query=A%2C%20Q1');
    expect(externalMapUrl({ name: 'A' })).toBeNull();
  });
});

describe('giờ mở cổng', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 3, h, m);

  it('đọc giờ HH:MM', () => {
    expect(parseClock('05:30')).toBe(330);
    expect(parseClock('24:00')).toBe(1440);
    expect(parseClock('7h')).toBeNull();
    expect(parseClock('12:75')).toBeNull();
  });

  it('mở trong ngày, đóng ngoài giờ; không có lịch = luôn mở', () => {
    const gate = { schedule: { open: '06:00', close: '18:00' } };
    expect(isGateOpen(gate, at(5, 59))).toBe(false);
    expect(isGateOpen(gate, at(6))).toBe(true);
    expect(isGateOpen(gate, at(17, 59))).toBe(true);
    expect(isGateOpen(gate, at(18))).toBe(false);
    expect(isGateOpen({}, at(3))).toBe(true);
  });

  it('lịch qua đêm (giờ đóng nhỏ hơn giờ mở)', () => {
    const night = { schedule: { open: '22:00', close: '06:00' } };
    expect(isGateOpen(night, at(23))).toBe(true);
    expect(isGateOpen(night, at(2))).toBe(true);
    expect(isGateOpen(night, at(12))).toBe(false);
  });
});

describe('dốc mẫu', () => {
  const site = createSampleSitePlan();
  const ramps = site.paths.filter((p) => p.kind === 'ramp');

  it('mỗi dốc ghi rõ khu phục vụ (Cấp cứu, Khoa Khám bệnh)', () => {
    expect(ramps.length).toBeGreaterThan(0);
    expect(new Set(ramps.map((r) => r.use))).toEqual(new Set(['emergency', 'outpatient']));
  });

  it('đỉnh dốc trùng đầu làn đón trả khách cùng khu — dốc, làn, dốc nối thành một vòng liền', () => {
    for (const r of ramps) {
      const top = r.points[r.points.length - 1]!;
      const lane = site.paths.find(
        (p) =>
          p.kind === 'vehicle' &&
          p.use === r.use &&
          p.points.some((q) => q.x === top.x && q.y === top.y),
      );
      expect(lane, r.id).toBeDefined();
    }
  });
});
