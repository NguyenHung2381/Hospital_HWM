import { boundsOf, type BBox, type Floor, type Point } from '@hwn/map-core';

/** Biến đổi từ toạ độ thế giới (m) sang màn hình (px): screen = R(rotation) · world * scale + (x, y). */
export interface ViewTransform {
  x: number;
  y: number;
  /** Số pixel trên mỗi mét. */
  scale: number;
  /** Góc xoay bản đồ (độ, theo chiều kim đồng hồ). Bỏ trống = 0. */
  rotation?: number;
}

export function floorBounds(floor: Floor): BBox | null {
  function* points() {
    for (const w of floor.walls) {
      yield w.start;
      yield w.end;
    }
    for (const r of floor.rooms) yield* r.polygon;
    for (const c of floor.connectors) yield* c.polygon;
    for (const n of floor.navGraph.nodes) yield n.position;
  }
  return boundsOf(points());
}

export function mergeBounds(boxes: readonly (BBox | null)[]): BBox | null {
  return boundsOf(
    boxes.flatMap((b) =>
      b
        ? [
            { x: b.minX, y: b.minY },
            { x: b.maxX, y: b.maxY },
          ]
        : [],
    ),
  );
}

/** Xoay vector `p` một góc `deg` (độ, theo chiều kim đồng hồ trên màn hình). */
const rotateVec = (p: Point, deg: number): Point => {
  if (!deg) return p;
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};

/** Khung nhìn đặt điểm thế giới `center` vào giữa khung `width` x `height`. */
export function centeredView(
  center: Point,
  scale: number,
  rotation: number,
  width: number,
  height: number,
): ViewTransform {
  const o = rotateVec({ x: center.x * scale, y: center.y * scale }, rotation);
  return { scale, rotation, x: width / 2 - o.x, y: height / 2 - o.y };
}

/**
 * Biến đổi để toàn bộ `bounds` nằm vừa khung `width` x `height`, chừa lề `padding` px.
 * Khi bản đồ xoay `rotation` độ, tính theo hộp bao của vùng sau khi xoay.
 */
export function fitTransform(
  bounds: BBox,
  width: number,
  height: number,
  padding = 24,
  rotation = 0,
): ViewTransform {
  const corners = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ].map((p) => rotateVec(p, rotation));
  const rb = boundsOf(corners)!;
  const w = Math.max(rb.maxX - rb.minX, 1e-3);
  const h = Math.max(rb.maxY - rb.minY, 1e-3);
  const availW = Math.max(width - padding * 2, 1);
  const availH = Math.max(height - padding * 2, 1);
  const scale = Math.min(availW / w, availH / h);
  const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  const view = centeredView(center, scale, rotation, width, height);
  return rotation ? view : { scale, x: view.x, y: view.y };
}

/** Phóng to/thu nhỏ quanh điểm màn hình `anchor`, giữ điểm thế giới dưới con trỏ đứng yên. */
export function zoomAt(t: ViewTransform, anchor: Point, newScale: number): ViewTransform {
  const world = screenToWorld(t, anchor);
  const o = rotateVec({ x: world.x * newScale, y: world.y * newScale }, t.rotation ?? 0);
  return { ...t, scale: newScale, x: anchor.x - o.x, y: anchor.y - o.y };
}

/** Đổi góc xoay, giữ nguyên điểm thế giới tại điểm màn hình `pivot`. */
export function rotateAt(t: ViewTransform, pivot: Point, rotation: number): ViewTransform {
  const world = screenToWorld(t, pivot);
  const o = rotateVec({ x: world.x * t.scale, y: world.y * t.scale }, rotation);
  return { ...t, rotation, x: pivot.x - o.x, y: pivot.y - o.y };
}

export const screenToWorld = (t: ViewTransform, p: Point): Point => {
  const v = rotateVec({ x: p.x - t.x, y: p.y - t.y }, -(t.rotation ?? 0));
  return { x: v.x / t.scale, y: v.y / t.scale };
};

export const worldToScreen = (t: ViewTransform, p: Point): Point => {
  const v = rotateVec({ x: p.x * t.scale, y: p.y * t.scale }, t.rotation ?? 0);
  return { x: v.x + t.x, y: v.y + t.y };
};

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
