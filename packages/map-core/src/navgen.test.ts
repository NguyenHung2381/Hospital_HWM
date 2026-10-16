import { describe, expect, it } from 'vitest';
import { boundsOf, polygonArea } from './geometry';
import { generateNavGraph } from './navgen';
import { findRoute } from './navigation';
import { enclosedAreaAt, enclosedAreas } from './rooms';
import { createSampleBuilding } from './sample';
import type { Building, Wall } from './types';
import { validateBuilding } from './validate';

const wall = (id: string, x1: number, y1: number, x2: number, y2: number): Wall => ({
  id,
  start: { x: x1, y: y1 },
  end: { x: x2, y: y2 },
  thickness: 0.2,
  height: 3,
});

describe('enclosedAreas', () => {
  it('tìm vùng kín kể cả khi tường nối chữ T vào giữa tường khác', () => {
    // Hình chữ nhật 10x6 chia đôi bởi một vách nối vào giữa hai cạnh dài.
    const walls = [
      wall('a', 0, 0, 10, 0),
      wall('b', 10, 0, 10, 6),
      wall('c', 10, 6, 0, 6),
      wall('d', 0, 6, 0, 0),
      wall('e', 4, 0, 4, 6),
    ];
    const areas = enclosedAreas(walls)
      .map(polygonArea)
      .sort((x, y) => x - y);
    expect(areas).toEqual([24, 36]);
    const right = enclosedAreaAt(walls, { x: 7, y: 3 })!;
    expect(boundsOf(right)).toEqual({ minX: 4, minY: 0, maxX: 10, maxY: 6 });
    expect(right).toHaveLength(4); // đỉnh thẳng hàng đã được gộp
  });

  it('bỏ qua tường cụt bên trong và trả null khi click ra ngoài', () => {
    const walls = [
      wall('a', 0, 0, 10, 0),
      wall('b', 10, 0, 10, 6),
      wall('c', 10, 6, 0, 6),
      wall('d', 0, 6, 0, 0),
      wall('stub', 5, 6, 5, 3), // vách cụt
    ];
    expect(polygonArea(enclosedAreaAt(walls, { x: 2, y: 2 })!)).toBeCloseTo(60);
    expect(enclosedAreaAt(walls, { x: 20, y: 2 })).toBeNull();
  });

  it('nhận đúng phòng trên mặt bằng mẫu', () => {
    const floor = createSampleBuilding().floors[0]!;
    const room = enclosedAreaAt(floor.walls, { x: 15, y: 4 })!;
    expect(boundsOf(room)).toEqual({ minX: 10, minY: 0, maxX: 20, maxY: 8 });
    const corridor = enclosedAreaAt(floor.walls, { x: 20, y: 10 })!;
    expect(boundsOf(corridor)).toEqual({ minX: 0, minY: 8, maxX: 40, maxY: 12 });
  });
});

/** Thay đồ thị vẽ tay của dữ liệu mẫu bằng đồ thị tự sinh. */
function withGeneratedGraphs(): { building: Building; warnings: string[] } {
  const building = createSampleBuilding();
  const warnings: string[] = [];
  for (const floor of building.floors) {
    const result = generateNavGraph(floor);
    floor.navGraph = result.graph;
    warnings.push(...result.warnings.map((w) => w.message));
  }
  return { building, warnings };
}

describe('generateNavGraph', () => {
  it('sinh đồ thị hợp lệ, không cảnh báo, nối mọi phòng và thang', () => {
    const { building, warnings } = withGeneratedGraphs();
    expect(warnings).toEqual([]);
    const result = validateBuilding(building);
    expect(result.issues).toEqual([]);
  });

  it('đường tâm hành lang chạy giữa hành lang (y = 10)', () => {
    const { building } = withGeneratedGraphs();
    const corridor = building.floors[0]!.navGraph.nodes.filter((n) => n.kind === 'corridor');
    expect(corridor.length).toBeGreaterThan(3);
    for (const n of corridor) expect(n.position.y).toBeCloseTo(10, 0);
  });

  it('chỉ đường được tới mọi phòng, quãng đường tương đương đồ thị vẽ tay', () => {
    const manual = createSampleBuilding();
    const { building } = withGeneratedGraphs();
    const from = { floorId: 'floor_1', position: { x: 1, y: 10 } };
    for (const floor of building.floors) {
      for (const room of floor.rooms) {
        const generated = findRoute(building, from, { roomId: room.id });
        const reference = findRoute(manual, from, { roomId: room.id })!;
        expect(generated, room.name).not.toBeNull();
        // Điểm cuối khác nhau một chút (tâm phòng vs điểm vẽ tay) nên cho phép lệch vài mét.
        expect(Math.abs(generated!.distance - reference.distance), room.name).toBeLessThan(5);
      }
    }
  });

  it('cảnh báo phòng không có cửa', () => {
    const building = createSampleBuilding();
    const floor = building.floors[0]!;
    const room = floor.rooms[1]!;
    floor.openings = floor.openings.filter(
      (o) => !(o.wallId === 'floor_1_wall_cor_n' && o.offset === 15),
    );
    const { warnings } = generateNavGraph(floor);
    expect(warnings).toContainEqual(expect.objectContaining({ refId: room.id }));
  });
});
