/// <reference types="node" />
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createLanPlanBuildings, createLanPlanCampus, PLAN_IMAGE_BASE } from './sample';
import { campusBuildingInfo, validateCampus } from './campus';
import { validateBuilding } from './validate';

const publicDir = fileURLToPath(new URL('../../../apps/admin/public', import.meta.url));

describe('mặt bằng theo bản vẽ LAN', () => {
  const buildings = createLanPlanBuildings();
  const campus = createLanPlanCampus();

  it('mỗi tầng có ảnh nền tồn tại, ID tầng và số tầng không trùng', () => {
    const floorIds = buildings.flatMap((b) => b.floors.map((f) => f.id));
    expect(new Set(floorIds).size).toBe(floorIds.length);
    for (const b of buildings) {
      const levels = b.floors.map((f) => f.level);
      expect(new Set(levels).size).toBe(levels.length);
      for (const f of b.floors) {
        expect(f.background?.metersPerPixel).toBeGreaterThan(0);
        expect(f.background!.url.startsWith(PLAN_IMAGE_BASE)).toBe(true);
        expect(existsSync(publicDir + f.background!.url)).toBe(true);
      }
    }
    expect(existsSync(publicDir + campus.background!.url)).toBe(true);
  });

  it('mỗi tầng có tường, cột, cửa trích từ bản vẽ và toà hợp lệ', () => {
    for (const b of buildings) {
      for (const f of b.floors) {
        expect(f.walls.length).toBeGreaterThan(50);
        expect(f.walls.some((w) => w.kind === 'concrete')).toBe(true);
        expect(f.openings.length).toBeGreaterThan(10);
      }
      expect(validateBuilding(b).issues.filter((i) => i.severity === 'error')).toEqual([]);
    }
  });

  it('nhà chính có thang bộ, thang máy nối nhiều tầng, thang cuốn và dốc', () => {
    const main = buildings.find((b) => b.id === 'bld_lan_main')!;
    const all = main.floors.flatMap((f) => f.connectors.map((c) => ({ c, level: f.level })));
    const types = new Set(all.map(({ c }) => c.type));
    expect([...types].sort()).toEqual(['elevator', 'escalator', 'ramp', 'stairs']);
    const floorsPerLink = new Map<string, Set<number>>();
    for (const { c, level } of all) {
      if (c.type !== 'elevator') continue;
      floorsPerLink.set(c.linkId, (floorsPerLink.get(c.linkId) ?? new Set()).add(level));
    }
    expect(Math.max(...[...floorsPerLink.values()].map((s) => s.size))).toBeGreaterThanOrEqual(3);
    expect(all.every(({ c }) => c.name.length > 0)).toBe(true);
  });

  it('thang trong sân trong là bậc từ sân lên tầng 1, không phải thang nối tầng', () => {
    const main = buildings.find((b) => b.id === 'bld_lan_main')!;
    const steps = (main.exterior?.paths ?? []).filter((p) => p.name?.startsWith('Bậc từ sân'));
    expect(steps.length).toBeGreaterThanOrEqual(6);
    for (const p of steps) {
      expect(p.kind).toBe('steps');
      expect(p.points).toHaveLength(2);
      expect(p.width).toBeGreaterThan(0.8);
    }
    // Thang bộ còn lại ở tầng 1 không có cái nào nằm ở vị trí bậc sân trong.
    const t1 = main.floors.find((f) => f.level === 0)!;
    for (const p of steps) {
      const m = {
        x: (p.points[0]!.x + p.points[1]!.x) / 2,
        y: (p.points[0]!.y + p.points[1]!.y) / 2,
      };
      const hit = t1.connectors.some((c) => {
        if (c.type !== 'stairs') return false;
        const xs = c.polygon.map((q) => q.x);
        const ys = c.polygon.map((q) => q.y);
        return (
          m.x > Math.min(...xs) &&
          m.x < Math.max(...xs) &&
          m.y > Math.min(...ys) &&
          m.y < Math.max(...ys)
        );
      });
      expect(hit).toBe(false);
    }
  });

  it('tường đi qua cửa sổ liền một đoạn, thang máy nối ≥ 2 tầng, bậc lối vào ra ngoài trời', () => {
    const main = buildings.find((b) => b.id === 'bld_lan_main')!;
    for (const f of main.floors) {
      expect(f.openings.filter((o) => o.type === 'window').length).toBeGreaterThan(20);
    }
    const floorsOf = new Map<string, Set<string>>();
    for (const f of main.floors) {
      for (const c of f.connectors) {
        floorsOf.set(c.linkId, (floorsOf.get(c.linkId) ?? new Set()).add(f.id));
      }
    }
    for (const f of main.floors) {
      for (const c of f.connectors) {
        if (c.type === 'elevator') expect(floorsOf.get(c.linkId)!.size).toBeGreaterThan(1);
      }
    }
    // Khoa một tầng: thang vẽ ở cửa vào là bậc tam cấp, không phải thang nối tầng.
    const dd = buildings.find((b) => b.id === 'bld_lan_dd')!;
    expect(dd.exterior?.paths.some((p) => p.kind === 'steps')).toBe(true);
  });

  it('ngoài trời có nhà cầu, khu bể nước và cơ sở hợp lệ', () => {
    const site = campus.site!;
    expect(site.paths.filter((p) => p.kind === 'covered')).toHaveLength(4);
    expect(site.areas.some((a) => a.kind === 'water')).toBe(true);
    const info = new Map(buildings.map((b) => [b.id, campusBuildingInfo(b)]));
    const issues = validateCampus(campus, info).issues;
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('cơ sở đặt đủ các toà', () => {
    expect(campus.buildings.map((p) => p.buildingId).sort()).toEqual(
      buildings.map((b) => b.id).sort(),
    );
  });
});
