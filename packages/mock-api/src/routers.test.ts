import { describe, expect, it } from 'vitest';
import { createSampleAnnex, createSampleBuilding, createSampleCampus } from '@hwn/map-core/sample';
import { buildingRouter, campusRouter } from './routers';

describe('bộ tìm đường lưu đệm', () => {
  it('dùng lại bộ tìm đường của toà tới khi version tăng', () => {
    const b = createSampleBuilding();
    const first = buildingRouter(b);
    expect(buildingRouter(b)).toBe(first);
    expect(buildingRouter(b, { accessibleOnly: true })).not.toBe(first);
    b.version += 1;
    expect(buildingRouter(b)).not.toBe(first);
  });

  it('dựng lại bộ tìm đường của cơ sở khi cơ sở hoặc một toà đổi', () => {
    const campus = createSampleCampus();
    const main = createSampleBuilding();
    const annex = createSampleAnnex();
    const buildings = new Map([
      [main.id, main],
      [annex.id, annex],
    ]);
    const first = campusRouter(campus, buildings);
    expect(campusRouter(campus, buildings)).toBe(first);
    annex.version += 1;
    const second = campusRouter(campus, buildings);
    expect(second).not.toBe(first);
    campus.version += 1;
    expect(campusRouter(campus, buildings)).not.toBe(second);
  });
});
