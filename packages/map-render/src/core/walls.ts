import {
  add,
  lerp,
  normalize,
  scale,
  sub,
  wallLength,
  type Id,
  type Opening,
  type OpeningType,
  type Point,
  type Wall,
  type WallKind,
} from '@hwn/map-core';

export const WALL_KINDS: { value: WallKind; label: string }[] = [
  { value: 'brick', label: 'Tường gạch' },
  { value: 'concrete', label: 'Tường bê tông (chịu lực)' },
  { value: 'partition', label: 'Vách ngăn (thạch cao)' },
  { value: 'glass', label: 'Vách kính' },
  { value: 'railing', label: 'Lan can / tường lửng' },
];

/** Loại tường thực tế (mặc định tường gạch). */
export const wallKindOf = (w: Pick<Wall, 'kind'>): WallKind => w.kind ?? 'brick';

export type WallSegmentKind = 'solid' | OpeningType;

/** Một đoạn liên tục trên tường: tường đặc, hoặc vị trí của một ô cửa. */
export interface WallSegment {
  kind: WallSegmentKind;
  /** Khoảng cách (m) từ `wall.start`. */
  from: number;
  to: number;
  start: Point;
  end: Point;
  openingId?: Id;
}

/**
 * Chia tường thành các đoạn theo thứ tự từ `start` tới `end`, phủ kín toàn bộ chiều dài.
 * Ô cửa bị kẹp trong phạm vi tường; ô cửa chồng lên nhau được cắt bớt để không trùng.
 */
export function layoutWall(wall: Wall, openings: readonly Opening[]): WallSegment[] {
  const len = wallLength(wall);
  if (len <= 0) return [];
  const at = (offset: number) => lerp(wall.start, wall.end, offset / len);

  const sorted = openings
    .filter((o) => o.wallId === wall.id)
    .map((o) => ({
      opening: o,
      from: Math.max(0, o.offset - o.width / 2),
      to: Math.min(len, o.offset + o.width / 2),
    }))
    .sort((a, b) => a.from - b.from);

  const segments: WallSegment[] = [];
  let cursor = 0;
  const push = (kind: WallSegmentKind, from: number, to: number, openingId?: Id) => {
    if (to - from > 1e-6) {
      segments.push({ kind, from, to, start: at(from), end: at(to), openingId });
    }
  };

  for (const { opening, from, to } of sorted) {
    const start = Math.max(from, cursor);
    if (to <= start) continue;
    push('solid', cursor, start);
    push(opening.type, start, to, opening.id);
    cursor = to;
  }
  push('solid', cursor, len);
  return segments;
}

/**
 * Hình chữ nhật (4 đỉnh) của một đoạn tường có độ dày `thickness`.
 * Đầu đoạn nằm ở đầu/cuối tường được kéo dài thêm `thickness / 2` để góc tường khép kín.
 */
export function segmentQuad(
  wall: Wall,
  segment: Pick<WallSegment, 'from' | 'to' | 'start' | 'end'>,
): Point[] {
  const len = wallLength(wall);
  const dir = normalize(sub(wall.end, wall.start));
  const half = wall.thickness / 2;
  const normal = { x: -dir.y * half, y: dir.x * half };
  const start = segment.from <= 1e-6 ? sub(segment.start, scale(dir, half)) : segment.start;
  const end = segment.to >= len - 1e-6 ? add(segment.end, scale(dir, half)) : segment.end;
  return [add(start, normal), add(end, normal), sub(end, normal), sub(start, normal)];
}
