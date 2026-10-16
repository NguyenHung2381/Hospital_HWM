import {
  add,
  lerp,
  normalize,
  scale,
  sub,
  type DoorStyle,
  type Opening,
  type Point,
} from '@hwn/map-core';

export const DOOR_STYLES: { value: DoorStyle; label: string }[] = [
  { value: 'single', label: 'Cửa 1 cánh' },
  { value: 'double', label: 'Cửa 2 cánh' },
  { value: 'sliding', label: 'Cửa lùa' },
  { value: 'automatic', label: 'Cửa tự động (2 cánh trượt)' },
  { value: 'opening', label: 'Lối đi không cánh' },
];

/** Kiểu cánh thực tế (có mặc định theo loại ô cửa). */
export const doorStyleOf = (o: Pick<Opening, 'type' | 'style'>): DoorStyle =>
  o.style ?? (o.type === 'entrance' ? 'double' : 'single');

/** Cánh cửa quay quanh bản lề: thanh cánh (đang mở 90°) + cung quét. */
export interface SwingLeaf {
  hinge: Point;
  /** Đầu cánh khi mở 90°. */
  tip: Point;
  /** Cung quét từ đầu cánh về mép ô cửa (các điểm liên tiếp). */
  arc: Point[];
}

/** Tấm cánh trượt, song song với tường. */
export interface SlidingPanel {
  a: Point;
  b: Point;
}

export interface DoorSymbol {
  leaves: SwingLeaf[];
  panels: SlidingPanel[];
}

function swingLeaf(hinge: Point, closedTip: Point, side: Point, steps = 10): SwingLeaf {
  const w = Math.hypot(closedTip.x - hinge.x, closedTip.y - hinge.y);
  const u = normalize(sub(closedTip, hinge));
  const arc: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * (Math.PI / 2);
    arc.push(add(hinge, add(scale(side, Math.cos(t) * w), scale(u, Math.sin(t) * w))));
  }
  return { hinge, tip: add(hinge, scale(side, w)), arc };
}

/**
 * Ký hiệu cánh cửa trên mặt bằng cho ô cửa từ `start` tới `end` (đã cắt trên tường).
 * Dùng chung cho 2D (vẽ cánh + cung) và 3D (dựng tấm cánh đang mở).
 */
export function doorSymbol(
  opening: Pick<Opening, 'type' | 'style' | 'hingeAtEnd' | 'opensOtherSide'>,
  start: Point,
  end: Point,
  wallThickness: number,
): DoorSymbol {
  const style = doorStyleOf(opening);
  const dir = normalize(sub(end, start));
  const sign = opening.opensOtherSide ? -1 : 1;
  const side = { x: -dir.y * sign, y: dir.x * sign };
  const [h, o] = opening.hingeAtEnd ? [end, start] : [start, end];
  const mid = lerp(start, end, 0.5);
  // Tấm trượt nằm sát mặt tường về phía mở.
  const offset = scale(side, wallThickness / 2 + 0.06);
  const width = Math.hypot(end.x - start.x, end.y - start.y);
  const u = normalize(sub(o, h));

  switch (style) {
    case 'single':
      return { leaves: [swingLeaf(h, o, side)], panels: [] };
    case 'double':
      return { leaves: [swingLeaf(start, mid, side), swingLeaf(end, mid, side)], panels: [] };
    case 'sliding': {
      // Cánh đang mở một nửa, trượt về phía bản lề (lùa vào trong tường).
      const a = add(sub(h, scale(u, width * 0.5)), offset);
      return { leaves: [], panels: [{ a, b: add(a, scale(u, width)) }] };
    }
    case 'automatic': {
      // Hai cánh trượt sang hai bên, đang mở một nửa.
      const q = width / 4;
      const s1 = add(start, offset);
      const s2 = add(end, offset);
      return {
        leaves: [],
        panels: [
          { a: sub(s1, scale(dir, q)), b: add(s1, scale(dir, q)) },
          { a: sub(s2, scale(dir, q)), b: add(s2, scale(dir, q)) },
        ],
      };
    }
    case 'opening':
      return { leaves: [], panels: [] };
  }
}

/** Trạng thái tiếp theo khi bấm "xoay cửa": đổi bản lề → đổi phía → … (4 trạng thái). */
export function nextDoorOrientation(o: Pick<Opening, 'hingeAtEnd' | 'opensOtherSide'>): {
  hingeAtEnd: boolean;
  opensOtherSide: boolean;
} {
  const h = !!o.hingeAtEnd;
  const s = !!o.opensOtherSide;
  // (đầu, trái) → (cuối, trái) → (cuối, phải) → (đầu, phải) → (đầu, trái)
  if (!h && !s) return { hingeAtEnd: true, opensOtherSide: false };
  if (h && !s) return { hingeAtEnd: true, opensOtherSide: true };
  if (h && s) return { hingeAtEnd: false, opensOtherSide: true };
  return { hingeAtEnd: false, opensOtherSide: false };
}
