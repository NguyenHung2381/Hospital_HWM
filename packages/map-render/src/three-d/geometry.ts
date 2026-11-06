/**
 * Dựng hình học 3D từ dữ liệu mặt bằng.
 * Quy ước: điểm mặt bằng (x, y) -> three.js (x, cao độ, y). Nhìn từ trên xuống, trục Z của three
 * hướng xuống màn hình giống trục y của bản đồ 2D nên không bị lật ảnh.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  rotatePoint,
  type Connector,
  type Floor,
  type Furniture,
  type Opening,
  type Point,
} from '@hwn/map-core';
import { furnitureShapes } from '../core/furniture';
import { floorBounds } from '../core/viewport';
import { layoutWall, segmentQuad, wallKindOf } from '../core/walls';
import { segmentOutline, wallJoints } from '../core/wallJoints';

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

/**
 * Gom nhiều khối lăng trụ đứng (đáy là đa giác mặt bằng) vào MỘT geometry, ghi thẳng đỉnh + pháp
 * tuyến phẳng vào mảng — nhanh hơn nhiều so với tạo `ExtrudeGeometry` cho từng khối rồi
 * `mergeGeometries` (tầng hàng nghìn tường). Chỉ có `position` + `normal` (không có uv).
 */
export class PrismBatch {
  private pos: number[] = [];
  private nor: number[] = [];

  /** Thêm khối lăng trụ từ cao độ `y0` tới `y1`. Bỏ qua đa giác suy biến. */
  add(points: readonly Point[], y0: number, y1: number): this {
    let pts = points;
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (pts.length > 3 && first && last && first.x === last.x && first.y === last.y) {
      pts = pts.slice(0, -1);
    }
    const n = pts.length;
    if (n < 3) return this;
    let area = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % n]!;
      area += a.x * b.y - b.x * a.y;
    }
    if (!(Math.abs(area) > 1e-12)) return this;
    // Đưa về diện tích có dấu dương: pháp tuyến ngoài của cạnh d là (d.y, −d.x) trên mặt bằng.
    if (area < 0) pts = [...pts].reverse();
    const top = Math.max(y0, y1);
    const bottom = Math.min(y0, y1);
    if (top - bottom < 1e-6) return this;

    // Mặt bên: mỗi cạnh một hình chữ nhật đứng (2 tam giác), pháp tuyến hướng ra ngoài.
    for (let i = 0; i < n; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % n]!;
      const dx = b.x - a.x;
      const dz = b.y - a.y;
      const len = Math.hypot(dx, dz);
      if (len < 1e-9) continue;
      const nx = dz / len;
      const nz = -dx / len;
      this.tri(a.x, bottom, a.y, b.x, top, b.y, b.x, bottom, b.y, nx, 0, nz);
      this.tri(a.x, bottom, a.y, a.x, top, a.y, b.x, top, b.y, nx, 0, nz);
    }

    // Nắp trên / dưới.
    const faces = isConvex(pts)
      ? Array.from({ length: n - 2 }, (_, i) => [0, i + 1, i + 2] as const)
      : THREE.ShapeUtils.triangulateShape(
          pts.map((p) => new THREE.Vector2(p.x, p.y)),
          [],
        );
    for (const [i, j, k] of faces) {
      const p = pts[i]!;
      let q = pts[j]!;
      let r = pts[k]!;
      // Pháp tuyến (theo chiều quấn) có thành phần y = −cross2D(q − p, r − p): nắp trên cần < 0.
      if ((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x) > 0) [q, r] = [r, q];
      this.tri(p.x, top, p.y, q.x, top, q.y, r.x, top, r.y, 0, 1, 0);
      this.tri(p.x, bottom, p.y, r.x, bottom, r.y, q.x, bottom, q.y, 0, -1, 0);
    }
    return this;
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  build(): THREE.BufferGeometry | null {
    if (this.empty) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.computeBoundingSphere();
    return g;
  }

  private tri(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    nx: number,
    ny: number,
    nz: number,
  ) {
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.nor.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  }
}

/** Đa giác lồi (mọi góc quay cùng chiều) — tam giác hoá kiểu quạt là đủ. */
function isConvex(pts: readonly Point[]): boolean {
  const n = pts.length;
  if (n === 3) return true;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    const c = pts[(i + 2) % n]!;
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-12) continue;
    const s = Math.sign(z);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
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
 * Dựng toàn bộ tường của một tầng thành 1–2 geometry đã gộp (ít draw call). Góc tường nối vát theo
 * mối nối (`wallJoints`).
 * @param heightScale tỉ lệ chiều cao tường (< 1 để nhìn được vào bên trong).
 */
export function buildWallGeometry(floor: Floor, heightScale = 1): WallGeometry {
  const openings = new Map(floor.openings.map((o) => [o.id, o]));
  // Gom ô cửa theo tường: layoutWall không phải lọc cả danh sách ô cửa của tầng cho từng tường.
  const openingsOf = new Map<string, Opening[]>();
  for (const o of floor.openings) {
    const list = openingsOf.get(o.wallId);
    if (list) list.push(o);
    else openingsOf.set(o.wallId, [o]);
  }
  // Mối nối vát giữa các tường: góc kín khít ở mọi góc, không chồng khối ở góc trong.
  const joints = wallJoints(floor.walls);
  const solid = new PrismBatch();
  const glass = new PrismBatch();

  for (const wall of floor.walls) {
    const h = wall.height * heightScale;
    // Vách kính dựng bằng vật liệu kính (cả phần tường đặc lẫn lanh tô).
    const body = wallKindOf(wall) === 'glass' ? glass : solid;
    for (const segment of layoutWall(wall, openingsOf.get(wall.id) ?? [])) {
      const quad = segmentOutline(wall, segment, joints.get(wall.id));
      const opening = segment.openingId ? openings.get(segment.openingId) : undefined;
      if (segment.kind === 'solid' || !opening) {
        body.add(quad, 0, h);
      } else if (segment.kind === 'window') {
        const sill = Math.min(opening.sillHeight, h);
        const top = Math.min(opening.sillHeight + opening.height, h);
        if (sill > 0) solid.add(quad, 0, sill);
        if (h > top) solid.add(quad, top, h);
        if (top > sill) {
          const pane = segmentQuad({ ...wall, thickness: wall.thickness * 0.25 }, segment);
          glass.add(pane, sill, top);
        }
      } else if (h > opening.height) {
        // Cửa đi / cửa chính: chỉ còn lanh tô phía trên.
        body.add(quad, opening.height, h);
      }
    }
  }
  return { solid: solid.build(), glass: glass.build() };
}

const wallCache = new WeakMap<Floor, Map<number, WallGeometry>>();

/**
 * `buildWallGeometry` có nhớ theo (tầng, tỉ lệ chiều cao): chuyển 2D ↔ 3D, đổi tầng cắt rồi quay
 * lại… không phải dựng lại tường (dữ liệu tầng bất biến — sửa tầng tạo object mới). Geometry dùng
 * chung, KHÔNG được biến đổi; `dispose()` khi gỡ cảnh vẫn an toàn (lần dùng sau tự nạp lại lên GPU).
 */
export function cachedWallGeometry(floor: Floor, heightScale = 1): WallGeometry {
  let byScale = wallCache.get(floor);
  if (!byScale) {
    byScale = new Map();
    wallCache.set(floor, byScale);
  }
  let walls = byScale.get(heightScale);
  if (!walls) {
    walls = buildWallGeometry(floor, heightScale);
    byScale.set(heightScale, walls);
  }
  return walls;
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

/** Số cạnh của đa giác xấp xỉ hình elip khi dựng khối. */
const ELLIPSE_SEGMENTS = 20;

/**
 * Nội thất / thiết bị: mỗi hình có tô của ký hiệu 2D thành một khối đứng theo cao độ của nó. Phần
 * "nhạt" (gối, nệm, bàn máy) tách riêng để tô màu khác.
 */
export function buildFurnitureGeometry(items: readonly Furniture[]): {
  body: THREE.BufferGeometry | null;
  soft: THREE.BufferGeometry | null;
} {
  const body = new PrismBatch();
  const soft = new PrismBatch();
  for (const f of items) {
    const place = (p: Point) =>
      rotatePoint({ x: f.position.x + p.x, y: f.position.y + p.y }, f.position, f.rotation ?? 0);
    for (const s of furnitureShapes(f.kind, f.width, f.depth)) {
      if (s.kind === 'line' || !s.z) continue;
      const outline =
        s.kind === 'rect'
          ? [
              { x: s.x, y: s.y },
              { x: s.x + s.w, y: s.y },
              { x: s.x + s.w, y: s.y + s.h },
              { x: s.x, y: s.y + s.h },
            ]
          : Array.from({ length: ELLIPSE_SEGMENTS }, (_, i) => {
              const a = (i / ELLIPSE_SEGMENTS) * Math.PI * 2;
              return { x: s.cx + s.rx * Math.cos(a), y: s.cy + s.ry * Math.sin(a) };
            });
      (s.fill === 'soft' ? soft : body).add(outline.map(place), s.z[0], s.z[1]);
    }
  }
  return { body: body.build(), soft: soft.build() };
}
