import { describe, expect, it } from 'vitest';
import { furnitureAcross, furniturePolygon, pointInPolygon, segmentHitsPolygon } from './geometry';
import { generateNavGraph } from './navgen';
import { findRoute } from './navigation';
import { createSampleBuilding } from './sample';
import type { Building, Floor, Furniture } from './types';
import { validateBuilding } from './validate';

const item = (id: string, x: number, y: number, width: number, depth: number): Furniture => ({
  id,
  kind: 'cabinet',
  position: { x, y },
  width,
  depth,
});

/** Mọi cạnh đồ thị của tầng không xuyên qua nội thất nào. */
const clearOfFurniture = (floor: Floor) => {
  const pos = new Map(floor.navGraph.nodes.map((n) => [n.id, n.position]));
  return floor.navGraph.edges.every(
    (e) => !furnitureAcross(floor.furniture, pos.get(e.from)!, pos.get(e.to)!),
  );
};

describe('nội thất làm vật cản', () => {
  it('hình chiếm chỗ theo góc xoay; đi sát mép không tính là xuyên qua', () => {
    const f = { ...item('a', 0, 0, 2, 1), rotation: 90 };
    const poly = furniturePolygon(f);
    expect(Math.max(...poly.map((p) => p.y))).toBeCloseTo(1);
    expect(segmentHitsPolygon({ x: -3, y: 0 }, { x: 3, y: 0 }, poly)).toBe(true);
    expect(furnitureAcross([f], { x: 0.5, y: -3 }, { x: 0.5, y: 3 })).toBeUndefined();
    expect(furnitureAcross([f], { x: 0.4, y: -3 }, { x: 0.4, y: 3 })).toBe(f);
  });

  it('tự sinh đồ thị: đường tâm hành lang đi vòng quanh tủ đặt giữa hành lang', () => {
    const building = createSampleBuilding();
    const floor = building.floors[0]!;
    // Hành lang mẫu y = 8..12; tủ 2 × 1,5 m kê sát tường trên, lấn qua đường tâm y = 10.
    floor.furniture = [item('tu', 20, 8.85, 2, 1.5)];
    floor.navGraph = generateNavGraph(floor).graph;
    expect(clearOfFurniture(floor)).toBe(true);
    const near = floor.navGraph.nodes.filter(
      (n) => n.kind === 'corridor' && Math.abs(n.position.x - 20) < 1.5,
    );
    for (const n of near) expect(n.position.y).toBeGreaterThan(10.4);
    const route = findRoute(
      building,
      { floorId: 'floor_1', position: { x: 1, y: 10 } },
      {
        roomId: 'floor_1_room_bot3',
      },
    );
    expect(route).not.toBeNull();
  });

  it('điểm đích tự sinh của phòng không rơi lên giường đặt giữa phòng', () => {
    const building = createSampleBuilding();
    const floor = building.floors[0]!;
    const room = floor.rooms.find((r) => r.id === 'floor_1_room_top1')!;
    delete room.destination;
    // Phòng P.102: x = 10..20, y = 0..8 → tâm (15, 4).
    const bed = { ...item('giuong', 15, 4, 0.9, 2), kind: 'bed' as const };
    floor.furniture = [bed];
    floor.navGraph = generateNavGraph(floor).graph;
    const node = floor.navGraph.nodes.find((n) => n.kind === 'room' && n.refId === room.id)!;
    expect(pointInPolygon(node.position, furniturePolygon(bed))).toBe(false);
    expect(pointInPolygon(node.position, room.polygon)).toBe(true);
  });

  it('chỉ đường ưu tiên đi vòng cạnh xuyên qua nội thất; kiểm tra báo cảnh báo', () => {
    // Đồ thị vẽ tay: A → B đi thẳng (5 m) hoặc vòng qua C (≈ 6.4 m); tủ chắn đường thẳng.
    const floor: Floor = {
      id: 'f',
      name: 'F',
      level: 1,
      elevation: 0,
      height: 3,
      walls: [],
      openings: [],
      connectors: [],
      rooms: [],
      furniture: [item('tu', 2.5, 0, 1, 1)],
      navGraph: {
        nodes: [
          { id: 'A', kind: 'corridor', position: { x: 0, y: 0 } },
          { id: 'B', kind: 'corridor', position: { x: 5, y: 0 } },
          { id: 'C', kind: 'corridor', position: { x: 2.5, y: 2 } },
        ],
        edges: [
          { id: 'ab', from: 'A', to: 'B' },
          { id: 'ac', from: 'A', to: 'C' },
          { id: 'cb', from: 'C', to: 'B' },
        ],
      },
    };
    const building: Building = {
      id: 'b',
      name: 'B',
      floors: [floor],
      departments: [],
      version: 1,
      updatedAt: '',
    };
    const route = findRoute(
      building,
      { floorId: 'f', position: { x: 0, y: 0 } },
      {
        floorId: 'f',
        position: { x: 5, y: 0 },
      },
    )!;
    expect(route.segments[0]!.path.some((p) => p.y > 1)).toBe(true);

    const issues = validateBuilding(building).issues.filter(
      (i) => i.code === 'NAV_THROUGH_FURNITURE',
    );
    expect(issues).toEqual([
      expect.objectContaining({ refId: 'tu', floorId: 'f', severity: 'warning' }),
    ]);

    // Không còn đường vòng: vẫn chỉ đường được (đi qua) thay vì báo không có đường.
    floor.navGraph.edges = [{ id: 'ab', from: 'A', to: 'B' }];
    expect(
      findRoute(
        building,
        { floorId: 'f', position: { x: 0, y: 0 } },
        { floorId: 'f', position: { x: 5, y: 0 } },
      ),
    ).not.toBeNull();
  });
});
