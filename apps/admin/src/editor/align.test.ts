import { describe, expect, it } from 'vitest';
import type { Floor } from '@hwn/map-core';
import { addFurniture, addWall, alignItems, distributeItems, selectionBounds } from './ops';
import type { ItemRef } from './types';

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

/** Ba ký hiệu rộng khác nhau, đặt lộn xộn. */
function scattered() {
  const floor = emptyFloor();
  const a = addFurniture(floor, 'chair', { x: 1, y: 1 }); // 0.5 × 0.5
  const b = addFurniture(floor, 'desk', { x: 5, y: 3 }); // 1.4 × 0.7
  const c = addFurniture(floor, 'cabinet', { x: 12, y: 2 }); // 1 × 0.5
  const refs: ItemRef[] = [a, b, c].map((f) => ({ type: 'furniture', id: f.id }));
  const box = (i: number) => selectionBounds(floor, [refs[i]!])!;
  return { floor, refs, box };
}

describe('căn chỉnh', () => {
  it('căn mép trái / phải / trên theo hộp bao chung, chỉ dời theo một trục', () => {
    const { floor, refs, box } = scattered();
    alignItems(floor, refs, 'left');
    for (let i = 0; i < 3; i++) expect(box(i).minX).toBeCloseTo(0.75);
    expect(floor.furniture!.map((f) => f.position.y)).toEqual([1, 3, 2]);

    alignItems(floor, refs, 'top');
    for (let i = 0; i < 3; i++) expect(box(i).minY).toBeCloseTo(0.75);

    alignItems(floor, refs, 'right');
    // Sau khi căn trái, mép phải xa nhất là của bàn (0.75 + 1.4).
    for (let i = 0; i < 3; i++) expect(box(i).maxX).toBeCloseTo(2.15);
  });

  it('căn giữa ngang', () => {
    const { floor, refs, box } = scattered();
    alignItems(floor, refs, 'centerX');
    // Hộp bao chung x: 0.75 → 12.5, tâm 6.625.
    for (let i = 0; i < 3; i++) expect((box(i).minX + box(i).maxX) / 2).toBeCloseTo(6.625);
  });

  it('cần ít nhất 2 đối tượng; ô cửa bị bỏ qua (đi theo tường)', () => {
    const { floor, refs } = scattered();
    const before = structuredClone(floor.furniture);
    alignItems(floor, refs.slice(0, 1), 'left');
    expect(floor.furniture).toEqual(before);
  });
});

describe('chia đều', () => {
  it('giữ hai đối tượng ngoài cùng, khoảng hở giữa các đối tượng bằng nhau', () => {
    const { floor, refs, box } = scattered();
    distributeItems(floor, refs, 'x');
    expect(box(0).minX).toBeCloseTo(0.75);
    expect(box(2).maxX).toBeCloseTo(12.5);
    const gap1 = box(1).minX - box(0).maxX;
    const gap2 = box(2).minX - box(1).maxX;
    expect(gap1).toBeCloseTo(gap2);
    // Chỉ dời theo trục x.
    expect(floor.furniture![1]!.position.y).toBe(3);
  });

  it('sắp theo vị trí chứ không theo thứ tự chọn; dưới 3 đối tượng thì không làm gì', () => {
    const { floor, refs, box } = scattered();
    distributeItems(floor, [refs[2]!, refs[0]!, refs[1]!], 'x');
    expect(box(1).minX - box(0).maxX).toBeCloseTo(box(2).minX - box(1).maxX);
    const before = structuredClone(floor.furniture);
    distributeItems(floor, refs.slice(0, 2), 'y');
    expect(floor.furniture).toEqual(before);
  });

  it('tường dời cả hai đầu', () => {
    const floor = emptyFloor();
    const w1 = addWall(floor, { x: 0, y: 0 }, { x: 0, y: 4 }, { thickness: 0.2 })!;
    const w2 = addWall(floor, { x: 3, y: 1 }, { x: 3, y: 5 }, { thickness: 0.2 })!;
    alignItems(
      floor,
      [
        { type: 'wall', id: w1.id },
        { type: 'wall', id: w2.id },
      ],
      'top',
    );
    expect(floor.walls[1]!.start).toEqual({ x: 3, y: 0 });
    expect(floor.walls[1]!.end).toEqual({ x: 3, y: 4 });
  });
});
