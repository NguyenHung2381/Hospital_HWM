import { describe, expect, it } from 'vitest';
import { sortedFloors, type Floor } from '@hwn/map-core';
import { createSampleBuilding } from '@hwn/map-core/sample';
import { buildStairGeometry, flightFor, flightPath, stairLayouts } from './stairs';

const STAIRS_1 = 'floor_1_conn_stairs_a';
const STAIRS_2 = 'floor_2_conn_stairs_a';

/** Thêm tầng 3 giống hệt tầng 2 để có tầng ở giữa. */
function threeFloors(): Floor[] {
  const floors = sortedFloors(createSampleBuilding());
  const top = structuredClone(floors[1]!);
  const rename = (id: string) => id.replace(/^floor_2/, 'floor_3');
  top.id = 'floor_3';
  top.level = 3;
  top.elevation += top.height;
  top.connectors = top.connectors.map((c) => ({ ...c, id: rename(c.id) }));
  top.navGraph.nodes = top.navGraph.nodes.map((n) => ({
    ...n,
    refId: n.refId && rename(n.refId),
  }));
  return [...floors, top];
}

describe('stairLayouts', () => {
  it('tầng thấp nhất chỉ có vế lên, tầng cao nhất chỉ có vế xuống', () => {
    const layouts = stairLayouts(sortedFloors(createSampleBuilding()));
    expect(layouts.get(STAIRS_1)!.flights.map((f) => f.direction)).toEqual(['up']);
    expect(layouts.get(STAIRS_2)!.flights.map((f) => f.direction)).toEqual(['down']);
  });

  it('tầng giữa chia đôi thành vế lên và vế xuống song song, không chồng lên nhau', () => {
    const layouts = stairLayouts(threeFloors());
    const mid = layouts.get(STAIRS_2)!;
    expect(mid.flights.map((f) => f.direction)).toEqual(['up', 'down']);
    const [up, down] = mid.flights.map((f) => f.frame);
    const full = layouts.get(STAIRS_1)!.flights[0]!.frame;
    expect(up!.halfWidth + down!.halfWidth).toBeLessThan(full.halfWidth);
    expect(up!.dir).toEqual(down!.dir);
  });

  it('không có heading thì đặt chân thang về phía cửa vào', () => {
    // Thang mẫu nằm ở dải phòng phía bắc, cửa mở ra hành lang phía nam (y lớn hơn).
    const { frame } = stairLayouts(sortedFloors(createSampleBuilding())).get(STAIRS_1)!.flights[0]!;
    expect(frame.dir.y).toBeLessThan(0);
  });

  it('tuyến đi lên kết thúc cao hơn sàn, đi xuống kết thúc thấp hơn sàn', () => {
    const layouts = stairLayouts(threeFloors());
    const mid = layouts.get(STAIRS_2)!;
    const [, upEnd] = flightPath(flightFor(mid, 'up'), 1.5, 10, 0.2);
    const [downStart, downEnd] = flightPath(flightFor(mid, 'down'), 1.5, 10, 0.2);
    expect(upEnd[1]).toBeGreaterThan(11);
    expect(downStart[1]).toBeCloseTo(10.2);
    expect(downEnd[1]).toBeLessThan(9);
  });

  it('khoét lỗ sàn cho mỗi vế xuống', () => {
    const layouts = [...stairLayouts(threeFloors()).values()];
    const g = buildStairGeometry(layouts, 1.5, { up: 2, down: 3 });
    expect(g.holes).toHaveLength(2); // tầng 2 và tầng 3
    expect(g.up && g.down && g.pit && g.arrows).toBeTruthy();
  });
});
