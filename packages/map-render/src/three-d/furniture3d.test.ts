import { describe, expect, it } from 'vitest';
import { buildFurnitureGeometry } from './geometry';

describe('nội thất 3D', () => {
  it('giường: thân cao 0,55 m, gối nằm trên mặt nệm; xoay 90° thì đổi chiều dài sang trục x', () => {
    const { body, soft } = buildFurnitureGeometry([
      { id: 'b', kind: 'bed', position: { x: 5, y: 3 }, width: 0.9, depth: 2 },
    ]);
    body!.computeBoundingBox();
    soft!.computeBoundingBox();
    expect(body!.boundingBox!.max.y).toBeCloseTo(0.55);
    expect(soft!.boundingBox!.min.y).toBeCloseTo(0.55);
    // Mặt bằng (x, y) → three (x, cao độ, z = y).
    expect(body!.boundingBox!.max.z - body!.boundingBox!.min.z).toBeCloseTo(2);

    const rotated = buildFurnitureGeometry([
      { id: 'b', kind: 'bed', position: { x: 5, y: 3 }, width: 0.9, depth: 2, rotation: 90 },
    ]).body!;
    rotated.computeBoundingBox();
    expect(rotated.boundingBox!.max.x - rotated.boundingBox!.min.x).toBeCloseTo(2);
    expect((rotated.boundingBox!.max.z + rotated.boundingBox!.min.z) / 2).toBeCloseTo(3);
  });

  it('phần đậm cao riêng (cột truyền dịch), không có nội thất thì không có khối', () => {
    const { body } = buildFurnitureGeometry([
      { id: 'p', kind: 'ivPole', position: { x: 0, y: 0 }, width: 0.45, depth: 0.45 },
    ]);
    body!.computeBoundingBox();
    expect(body!.boundingBox!.max.y).toBeCloseTo(1.9);
    expect(buildFurnitureGeometry([])).toEqual({ body: null, soft: null });
  });
});
