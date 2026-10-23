/** Đặt ký hiệu nội thất / thiết bị (danh mục ở `@hwn/map-render`): bám sát tường, chuẩn hoá góc. */
import {
  add,
  angleOf,
  distance,
  normalize,
  projectPointOnSegment,
  scale,
  sub,
  toDegrees,
  wallLength,
  type Floor,
  type Point,
} from '@hwn/map-core';

export interface FurniturePlacement {
  position: Point;
  rotation: number;
  /** Đang bám sát tường. */
  againstWall: boolean;
}

/** Góc về khoảng [-180°, 180°), làm tròn bỏ sai số. */
export const normalizeAngle = (deg: number) =>
  Math.round((((((deg + 180) % 360) + 360) % 360) - 180) * 1e6) / 1e6;

/**
 * Vị trí đặt ký hiệu khi con trỏ ở `p`: gần tường (con trỏ cách mặt tường không quá
 * `depth + reach`) thì quay lưng vào tường, áp sát mặt tường và trượt dọc theo tường; nếu không thì
 * đặt tự do tại `p`, giữ góc `rotation`.
 */
export function placeFurniture(
  floor: Pick<Floor, 'walls'>,
  size: { width: number; depth: number },
  p: Point,
  rotation: number,
  reach: number,
): FurniturePlacement {
  let best: { d: number; place: FurniturePlacement } | null = null;
  for (const w of floor.walls) {
    const len = wallLength(w);
    if (len < 1e-6) continue;
    const proj = projectPointOnSegment(p, w.start, w.end);
    const face = proj.distance - w.thickness / 2;
    if (face > size.depth + reach || (best && face >= best.d)) continue;
    const dir = normalize(sub(w.end, w.start));
    const n = { x: -dir.y, y: dir.x };
    // Pháp tuyến hướng từ tường về phía con trỏ.
    const side = (p.x - w.start.x) * n.x + (p.y - w.start.y) * n.y >= 0 ? 1 : -1;
    const inward = scale(n, side);
    // Không cho ký hiệu thò ra ngoài hai đầu tường (nếu tường đủ dài).
    const along = distance(w.start, proj.point);
    const half = size.width / 2;
    const t = len >= size.width ? Math.min(Math.max(along, half), len - half) : len / 2;
    const onWall = add(w.start, scale(dir, t));
    best = {
      d: face,
      place: {
        position: add(onWall, scale(inward, w.thickness / 2 + size.depth / 2)),
        // Lưng (phía -y) quay vào tường: trục +y của ký hiệu trùng với `inward`.
        rotation: normalizeAngle(toDegrees(angleOf(inward)) - 90),
        againstWall: true,
      },
    };
  }
  return best?.place ?? { position: p, rotation, againstWall: false };
}
