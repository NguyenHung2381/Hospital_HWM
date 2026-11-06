import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Point } from '@hwn/map-core';
import { PrismBatch } from './geometry';

/** Thể tích có dấu (> 0 khi mọi mặt quấn hướng ra ngoài) và số tam giác sai chiều pháp tuyến. */
function inspect(g: THREE.BufferGeometry) {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  let volume = 0;
  let flipped = 0;
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.fromBufferAttribute(nor, i);
    volume += a.dot(b.clone().cross(c)) / 6;
    const face = b.clone().sub(a).cross(c.clone().sub(a));
    if (face.lengthSq() > 1e-12 && face.dot(n) <= 0) flipped++;
  }
  return { volume, flipped, triangles: pos.count / 3 };
}

const square: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

describe('PrismBatch', () => {
  it('khối hộp: kín, mặt quấn ra ngoài khớp pháp tuyến', () => {
    const g = new PrismBatch().add(square, 0.5, 2.5).build()!;
    const r = inspect(g);
    expect(r.triangles).toBe(12);
    expect(r.flipped).toBe(0);
    expect(r.volume).toBeCloseTo(2, 9);
    const box = new THREE.Box3().setFromBufferAttribute(
      g.getAttribute('position') as THREE.BufferAttribute,
    );
    expect(box.min.toArray()).toEqual([0, 0.5, 0]);
    expect(box.max.toArray()).toEqual([1, 2.5, 1]);
  });

  it('đa giác ngược chiều và đa giác lõm (chữ L) vẫn đúng thể tích', () => {
    const l: Point[] = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
    ];
    for (const poly of [[...square].reverse(), l, [...l].reverse()]) {
      const r = inspect(new PrismBatch().add(poly, 0, 3).build()!);
      expect(r.flipped).toBe(0);
      const area = poly.length === 4 ? 1 : 4; // hình vuông 1 m², chữ L 3 + 1 m²
      expect(r.volume).toBeCloseTo(area * 3, 9);
    }
  });

  it('gộp nhiều khối, bỏ qua đa giác suy biến', () => {
    const batch = new PrismBatch()
      .add(square, 0, 1)
      .add(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        0,
        1,
      )
      .add(
        [
          { x: 5, y: 0 },
          { x: 6, y: 0 },
          { x: 7, y: 0 },
        ],
        0,
        1,
      )
      .add(
        square.map((p) => ({ x: p.x + 2, y: p.y })),
        1,
        1,
      )
      .add(
        square.map((p) => ({ x: p.x + 4, y: p.y })),
        0,
        2,
      );
    const r = inspect(batch.build()!);
    expect(r.triangles).toBe(24);
    expect(r.volume).toBeCloseTo(3, 9);
    expect(new PrismBatch().build()).toBeNull();
  });
});
