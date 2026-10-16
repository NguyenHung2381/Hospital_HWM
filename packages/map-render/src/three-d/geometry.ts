/**
 * Dựng hình học 3D từ dữ liệu mặt bằng.
 * Quy ước: điểm mặt bằng (x, y) -> three.js (x, cao độ, y). Nhìn từ trên xuống, trục Z của three
 * hướng xuống màn hình giống trục y của bản đồ 2D nên không bị lật ảnh.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { type Connector, type Floor, type Point } from '@hwn/map-core';
import { floorBounds } from '../core/viewport';
import { layoutWall, segmentQuad, wallKindOf } from '../core/walls';

export type Vec3 = [number, number, number];

export const toVec3 = (p: Point, y: number): Vec3 => [p.x, y, p.y];

function shapeOf(points: readonly Point[]): THREE.Shape {
  return new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, -p.y)));
}

/** Khối lăng trụ đứng có đáy là đa giác mặt bằng, từ cao độ `y0` tới `y1`. */
export function prism(points: readonly Point[], y0: number, y1: number): THREE.BufferGeometry {
  const geometry = new THREE.ExtrudeGeometry(shapeOf(points), {
    depth: Math.max(y1 - y0, 1e-3),
    bevelEnabled: false,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y0, 0);
  return geometry;
}

/** Mặt phẳng nằm ngang có dạng đa giác, ở cao độ `y`. */
export function flatPolygon(points: readonly Point[], y: number): THREE.BufferGeometry {
  const geometry = new THREE.ShapeGeometry(shapeOf(points));
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

export function mergeAll(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (geometries.length === 0) return null;
  const merged = mergeGeometries(geometries, false);
  for (const g of geometries) g.dispose();
  return merged;
}

export interface WallGeometry {
  /** Tường đặc (trừ vách kính), gồm cả phần dưới/trên ô cửa sổ và lanh tô trên cửa đi. */
  solid: THREE.BufferGeometry | null;
  /** Kính cửa sổ và vách kính. */
  glass: THREE.BufferGeometry | null;
}

/**
 * Dựng toàn bộ tường của một tầng thành 1–2 geometry đã gộp (ít draw call).
 * @param heightScale tỉ lệ chiều cao tường (< 1 để nhìn được vào bên trong).
 */
export function buildWallGeometry(floor: Floor, heightScale = 1): WallGeometry {
  const openings = new Map(floor.openings.map((o) => [o.id, o]));
  const solid: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];

  for (const wall of floor.walls) {
    const h = wall.height * heightScale;
    // Vách kính dựng bằng vật liệu kính (cả phần tường đặc lẫn lanh tô).
    const body = wallKindOf(wall) === 'glass' ? glass : solid;
    for (const segment of layoutWall(wall, floor.openings)) {
      const quad = segmentQuad(wall, segment);
      const opening = segment.openingId ? openings.get(segment.openingId) : undefined;
      if (segment.kind === 'solid' || !opening) {
        body.push(prism(quad, 0, h));
      } else if (segment.kind === 'window') {
        const sill = Math.min(opening.sillHeight, h);
        const top = Math.min(opening.sillHeight + opening.height, h);
        if (sill > 0) solid.push(prism(quad, 0, sill));
        if (h > top) solid.push(prism(quad, top, h));
        if (top > sill) {
          const pane = segmentQuad({ ...wall, thickness: wall.thickness * 0.25 }, segment);
          glass.push(prism(pane, sill, top));
        }
      } else if (h > opening.height) {
        // Cửa đi / cửa chính: chỉ còn lanh tô phía trên.
        body.push(prism(quad, opening.height, h));
      }
    }
  }
  return { solid: mergeAll(solid), glass: mergeAll(glass) };
}

/**
 * Tấm sàn bao quanh toàn bộ mặt bằng tầng.
 * @param holes các lỗ khoét xuyên sàn (ví dụ hố thang đi xuống).
 */
export function buildSlabGeometry(
  floor: Floor,
  holes: readonly (readonly Point[])[] = [],
  thickness = 0.12,
): THREE.BufferGeometry | null {
  const b = floorBounds(floor);
  if (!b) return null;
  const pad = 0.5;
  const shape = shapeOf([
    { x: b.minX - pad, y: b.minY - pad },
    { x: b.maxX + pad, y: b.minY - pad },
    { x: b.maxX + pad, y: b.maxY + pad },
    { x: b.minX - pad, y: b.maxY + pad },
  ]);
  shape.holes = holes.map((h) => new THREE.Path(h.map((p) => new THREE.Vector2(p.x, -p.y))));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -thickness, 0);
  return geometry;
}

/** Thang máy: hộp giếng thang. Thang bộ/thang cuốn dựng riêng trong `stairs.ts`. */
export function buildElevatorGeometry(connector: Connector, height: number): THREE.BufferGeometry {
  return prism(connector.polygon, 0, height);
}
