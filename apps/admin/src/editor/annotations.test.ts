import { describe, expect, it } from 'vitest';
import type { DimensionAnnotation, Floor, TextAnnotation } from '@hwn/map-core';
import {
  addDimension,
  addText,
  addWall,
  allItems,
  annotationPoints,
  copyItems,
  deleteItems,
  dimensionLine,
  dimensionOffsetAt,
  itemsInRect,
  pasteItems,
  transformItems,
  uprightAngle,
  withoutLayers,
} from './ops';
import { hitTest } from './snap';
import { useEditor } from './store';

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

describe('đường kích thước', () => {
  it('dời theo pháp tuyến trái; khoảng dời tính từ điểm con trỏ', () => {
    const floor = emptyFloor();
    // Đoạn hướng +x, pháp tuyến trái (trục y hướng xuống) là (0, 1).
    const dim = addDimension(floor, { x: 0, y: 0 }, { x: 4, y: 0 }, 1)!;
    const line = dimensionLine(dim);
    expect(line.length).toBe(4);
    close(line.a, { x: 0, y: 1 });
    close(line.b, { x: 4, y: 1 });
    expect(dimensionOffsetAt(dim.start, dim.end, { x: 2, y: -0.5 })).toBeCloseTo(-0.5);
    expect(addDimension(floor, { x: 0, y: 0 }, { x: 0.01, y: 0 }, 1)).toBeNull();
  });

  it('lật / xoay giữ đường kích thước ở đúng phía', () => {
    const floor = emptyFloor();
    const dim = addDimension(floor, { x: 0, y: 0 }, { x: 4, y: 0 }, 1)!;
    const ref = [{ type: 'annotation' as const, id: dim.id }];
    const before = annotationPoints(dim).slice(2);
    transformItems(floor, ref, 'flipX');
    const flipped = floor.annotations![0] as DimensionAnnotation;
    // Lật ngang quanh tâm: đường kích thước vẫn nằm ở y = 1 (không nhảy sang y = -1).
    const after = annotationPoints(flipped).slice(2);
    expect(Math.min(...after.map((p) => p.y))).toBeCloseTo(1);
    expect(after.map((p) => p.x).sort()).toEqual(before.map((p) => p.x).sort());

    transformItems(floor, ref, 'rotate');
    const rotated = floor.annotations![0] as DimensionAnnotation;
    expect(dimensionLine(rotated).length).toBeCloseTo(4);
    expect(Math.abs(rotated.offset)).toBeCloseTo(1);
  });

  it('chọn được bằng click gần đường kích thước và bằng khung chọn', () => {
    const floor = emptyFloor();
    const dim = addDimension(floor, { x: 0, y: 0 }, { x: 4, y: 0 }, 1)!;
    expect(hitTest(floor, { x: 2, y: 1.05 }, 0.1)).toEqual({ type: 'annotation', id: dim.id });
    expect(hitTest(floor, { x: 2, y: 3 }, 0.1)).toBeNull();
    const box = { minX: -1, minY: 0.5, maxX: 5, maxY: 1.5 };
    expect(itemsInRect(floor, box, 'contain')).toEqual([{ type: 'annotation', id: dim.id }]);
  });
});

describe('chú thích chữ', () => {
  it('góc xoay luôn đọc được', () => {
    expect(uprightAngle(0)).toBe(0);
    expect(uprightAngle(180)).toBe(0);
    expect(uprightAngle(135)).toBe(-45);
    expect(uprightAngle(-90)).toBe(90);
    expect(uprightAngle(450)).toBe(90);
  });

  it('xoay 90° rồi lật: chữ dời theo, không lộn ngược', () => {
    const floor = emptyFloor();
    const note = addText(floor, { x: 2, y: 0 }, 'Kho');
    addWall(floor, { x: 0, y: 0 }, { x: 4, y: 0 }, { thickness: 0.2 });
    const refs = [
      { type: 'annotation' as const, id: note.id },
      { type: 'wall' as const, id: floor.walls[0]!.id },
    ];
    transformItems(floor, refs, 'rotate');
    const t = floor.annotations![0] as TextAnnotation;
    close(t.position, { x: 2, y: 0 });
    expect(t.rotation).toBe(90);
    transformItems(floor, refs, 'flipY');
    expect((floor.annotations![0] as TextAnnotation).rotation).toBe(90);
  });

  it('click vào khối chữ thì chọn chữ trước tường bên dưới', () => {
    const floor = emptyFloor();
    addWall(floor, { x: 0, y: 0 }, { x: 4, y: 0 }, { thickness: 0.2 });
    const note = addText(floor, { x: 2, y: 0 }, 'Hành lang', 0.5);
    expect(hitTest(floor, { x: 2.5, y: 0.1 }, 0.1)).toEqual({ type: 'annotation', id: note.id });
  });

  it('copy / dán / xoá cùng các đối tượng khác', () => {
    const floor = emptyFloor();
    const note = addText(floor, { x: 1, y: 1 }, 'A');
    const dim = addDimension(floor, { x: 0, y: 0 }, { x: 3, y: 0 }, -0.5)!;
    const clip = copyItems(floor, allItems(floor))!;
    const created = pasteItems(floor, clip, { x: 10, y: 0 });
    expect(created).toHaveLength(2);
    expect(floor.annotations).toHaveLength(4);
    close((floor.annotations![2] as TextAnnotation).position, { x: 11, y: 1 });
    expect((floor.annotations![3] as DimensionAnnotation).offset).toBeCloseTo(-0.5);
    deleteItems(floor, [
      { type: 'annotation', id: note.id },
      { type: 'annotation', id: dim.id },
    ]);
    expect(floor.annotations!.map((a) => a.id)).toEqual(created.map((r) => r.id));
  });
});

describe('lớp', () => {
  it('bỏ lớp tường kéo theo ô cửa; tầng gốc không đổi', () => {
    const floor = emptyFloor();
    addWall(floor, { x: 0, y: 0 }, { x: 4, y: 0 }, { thickness: 0.2 });
    floor.openings.push({
      id: 'o',
      type: 'door',
      wallId: floor.walls[0]!.id,
      offset: 2,
      width: 1,
      height: 2,
      sillHeight: 0,
    });
    addText(floor, { x: 1, y: 1 }, 'A');
    expect(withoutLayers(floor, [])).toBe(floor);
    const view = withoutLayers(floor, ['walls']);
    expect(view.walls).toEqual([]);
    expect(view.openings).toEqual([]);
    expect(view.annotations).toHaveLength(1);
    expect(floor.walls).toHaveLength(1);
    expect(hitTest(view, { x: 2, y: 0 }, 0.1)).toBeNull();
  });

  it('ẩn / khoá lớp bỏ đối tượng đó khỏi vùng chọn; chọn công cụ vẽ thì lớp tự hiện', () => {
    const s = useEditor.getState();
    s.select([
      { type: 'wall', id: 'w' },
      { type: 'annotation', id: 'n' },
    ]);
    s.setSettings({ lockedLayers: ['walls'] });
    expect(useEditor.getState().selection).toEqual([{ type: 'annotation', id: 'n' }]);
    s.setSettings({ hiddenLayers: ['annotations'] });
    expect(useEditor.getState().selection).toEqual([]);
    s.setTool('text');
    expect(useEditor.getState().settings.hiddenLayers).toEqual([]);
    expect(useEditor.getState().settings.lockedLayers).toEqual(['walls']);
  });
});
