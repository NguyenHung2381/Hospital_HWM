import { describe, expect, it } from 'vitest';
import type { Floor } from '@hwn/map-core';
import { FURNITURE, FURNITURE_KINDS, furnitureShapes } from '@hwn/map-render';
import { normalizeAngle, placeFurniture } from './furniture';
import {
  addFurniture,
  addWall,
  allItems,
  copyItems,
  furnitureCorners,
  itemsInRect,
  pasteItems,
  selectionOutlines,
  transformItems,
  withoutLayers,
} from './ops';
import { floorToSvg } from './exportPlan';
import { hitTest } from './snap';

const emptyFloor = (): Floor => ({
  id: 'f',
  name: 'F',
  level: 1,
  elevation: 0,
  height: 3,
  walls: [],
  openings: [],
  connectors: [],
  rooms: [],
  navGraph: { nodes: [], edges: [] },
});

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x);
  expect(a.y).toBeCloseTo(b.y);
};

describe('thư viện ký hiệu', () => {
  it('mọi ký hiệu có kích thước dương và hình vẽ nằm trong khung', () => {
    for (const kind of FURNITURE_KINDS) {
      const { width, depth } = FURNITURE[kind];
      expect(width).toBeGreaterThan(0);
      expect(depth).toBeGreaterThan(0);
      for (const s of furnitureShapes(kind, width, depth)) {
        const xs =
          s.kind === 'rect'
            ? [s.x, s.x + s.w]
            : s.kind === 'ellipse'
              ? [s.cx - s.rx, s.cx + s.rx]
              : s.points.filter((_, i) => i % 2 === 0);
        for (const x of xs) expect(Math.abs(x)).toBeLessThanOrEqual(width / 2 + 1e-9);
      }
    }
  });

  it('chuẩn hoá góc về [-180°, 180°)', () => {
    expect(normalizeAngle(270)).toBe(-90);
    expect(normalizeAngle(-180)).toBe(-180);
    expect(normalizeAngle(180)).toBe(-180);
    expect(normalizeAngle(450)).toBe(90);
  });
});

describe('đặt sát tường', () => {
  // Tường ngang dày 0.2 m từ (0,0) tới (10,0); phòng nằm phía dưới (y > 0).
  const floor = emptyFloor();
  addWall(floor, { x: 0, y: 0 }, { x: 10, y: 0 }, { thickness: 0.2 });
  const bed = FURNITURE.bed;

  it('quay đầu giường vào tường, áp sát mặt tường, trượt theo con trỏ', () => {
    const place = placeFurniture(floor, bed, { x: 4, y: 1.5 }, 0, 0.3);
    expect(place.againstWall).toBe(true);
    // Lưng (phía -y) quay lên tường → không xoay; tâm cách tim tường 0.1 + 1.0.
    expect(place.rotation).toBe(0);
    close(place.position, { x: 4, y: 1.1 });
  });

  it('phía bên kia tường thì quay ngược lại', () => {
    const place = placeFurniture(floor, bed, { x: 4, y: -1 }, 0, 0.3);
    expect(Math.abs(place.rotation)).toBe(180);
    close(place.position, { x: 4, y: -1.1 });
  });

  it('không thò ra ngoài đầu tường; xa tường thì đặt tự do, giữ góc xoay', () => {
    close(placeFurniture(floor, bed, { x: 0.1, y: 1 }, 0, 0.3).position, { x: 0.45, y: 1.1 });
    const free = placeFurniture(floor, bed, { x: 4, y: 5 }, 90, 0.3);
    expect(free).toEqual({ position: { x: 4, y: 5 }, rotation: 90, againstWall: false });
  });

  it('tường dọc: lưng quay sang tường bên trái', () => {
    const f = emptyFloor();
    addWall(f, { x: 0, y: 0 }, { x: 0, y: 10 }, { thickness: 0.2 });
    const place = placeFurniture(f, FURNITURE.chairRow, { x: 0.5, y: 5 }, 0, 0.3);
    expect(place.rotation).toBe(-90);
    close(place.position, { x: 0.4, y: 5 });
    // Góc xoay -90°: các góc ký hiệu nằm trong khoảng x ∈ [0.1, 0.7] (sát mặt tường).
    const corners = furnitureCorners({
      id: 'x',
      kind: 'chairRow',
      position: place.position,
      rotation: place.rotation,
      width: 1.8,
      depth: 0.6,
    });
    expect(Math.min(...corners.map((c) => c.x))).toBeCloseTo(0.1);
  });
});

describe('thao tác', () => {
  it('chọn bằng click (tường được ưu tiên), khung chọn, xoay, copy / dán, ẩn lớp', () => {
    const floor = emptyFloor();
    addWall(floor, { x: 0, y: 0 }, { x: 10, y: 0 }, { thickness: 0.2 });
    const bed = addFurniture(floor, 'bed', { x: 2, y: 1.1 });
    expect(bed.rotation).toBeUndefined();
    const ref = { type: 'furniture' as const, id: bed.id };
    expect(hitTest(floor, { x: 2, y: 1.5 }, 0.1)).toEqual(ref);
    expect(hitTest(floor, { x: 2, y: 0.05 }, 0.1)?.type).toBe('wall');
    expect(itemsInRect(floor, { minX: 1, minY: 0, maxX: 3, maxY: 2.5 }, 'contain')).toContainEqual(
      ref,
    );

    transformItems(floor, [ref], 'rotate');
    expect(floor.furniture![0]!.rotation).toBe(90);
    close(floor.furniture![0]!.position, { x: 2, y: 1.1 });

    const clip = copyItems(floor, [ref])!;
    const [pasted] = pasteItems(floor, clip, { x: 1, y: 0 });
    expect(pasted?.type).toBe('furniture');
    expect(floor.furniture).toHaveLength(2);
    close(floor.furniture![1]!.position, { x: 3, y: 1.1 });
    expect(floor.furniture![1]!.rotation).toBe(90);

    expect(allItems(floor).filter((r) => r.type === 'furniture')).toHaveLength(2);
    expect(withoutLayers(floor, ['furniture']).furniture).toEqual([]);

    // Viền vùng chọn cho cảnh 3D: ký hiệu theo 4 góc đã xoay, tường theo độ dày.
    const [outline] = selectionOutlines(floor, [ref]);
    expect(outline!.closed).toBe(true);
    expect(outline!.points).toEqual(furnitureCorners(floor.furniture![0]!));
    const [wallOutline] = selectionOutlines(floor, [{ type: 'wall', id: floor.walls[0]!.id }]);
    expect(Math.max(...wallOutline!.points.map((p) => p.y))).toBeCloseTo(0.1);

    // Bản xuất SVG vẽ ký hiệu theo đúng vị trí, góc xoay; ẩn lớp thì bỏ.
    const building = {
      id: 'b',
      name: 'B',
      floors: [floor],
      departments: [],
      version: 1,
      updatedAt: '',
    };
    expect(floorToSvg(building, floor).svg).toContain('translate(3 1.1) rotate(90)');
    expect(floorToSvg(building, floor, { hiddenLayers: ['furniture'] }).svg).not.toContain(
      'rotate(90)',
    );
  });
});
