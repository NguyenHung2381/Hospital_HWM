/**
 * Đặt nhãn tránh chồng nhau: lần lượt theo thứ tự ưu tiên, mỗi nhãn lấy vị trí thử đầu tiên không
 * đè lên nhãn đã đặt hoặc vật cản (biểu tượng); không còn chỗ thì ẩn nhãn đó (phóng gần sẽ hiện).
 * Kích thước nhãn tính theo px màn hình rồi đổi ra mét theo `scale` (px / m).
 */
import type { BBox, Point } from '@hwn/map-core';

/**
 * Vị trí thử: điểm (px, so với `anchor`) mà nhãn bám vào.
 * `alignX`: -1 = mép phải của nhãn tại điểm đó, 0 = giữa, 1 = mép trái · `alignY` tương tự theo chiều dọc.
 */
export interface LabelCandidate {
  dx: number;
  dy: number;
  alignX: -1 | 0 | 1;
  alignY: -1 | 0 | 1;
}

export interface LabelRequest {
  key: string;
  text: string;
  anchor: Point;
  candidates: readonly LabelCandidate[];
  fontSize: number;
  bold?: boolean;
  /** Bề rộng tối đa (m) — nhãn dài hơn thì ẩn (vd. tên khu vực không lọt trong khu vực). */
  maxWidth?: number;
}

export interface PlacedLabel {
  key: string;
  text: string;
  /** Góc trên trái + kích thước (m). */
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MeasureText = (text: string, fontSize: number, bold: boolean) => number;

let ctx: CanvasRenderingContext2D | null | undefined;
const widthCache = new Map<string, number>();

/** Bề rộng chữ (px) theo font mặc định của Konva; ngoài trình duyệt thì ước lượng. */
export const measureText: MeasureText = (text, fontSize, bold) => {
  const key = `${bold ? 'b' : 'n'}${fontSize}:${text}`;
  const hit = widthCache.get(key);
  if (hit !== undefined) return hit;
  if (ctx === undefined) {
    try {
      ctx =
        typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    } catch {
      ctx = null;
    }
  }
  let w = text.length * fontSize * (bold ? 0.62 : 0.56);
  if (ctx) {
    ctx.font = `${bold ? 'bold ' : ''}${fontSize}px Arial`;
    w = ctx.measureText(text).width;
  }
  widthCache.set(key, w);
  return w;
};

/** Các vị trí thử quanh một biểu tượng bán kính `r` px: dưới, trên, phải, trái. */
export const aroundMarker = (r: number, gap = 2): LabelCandidate[] => [
  { dx: 0, dy: r + gap, alignX: 0, alignY: 1 },
  { dx: 0, dy: -r - gap, alignX: 0, alignY: -1 },
  { dx: r + gap + 2, dy: 0, alignX: 1, alignY: 0 },
  { dx: -r - gap - 2, dy: 0, alignX: -1, alignY: 0 },
];

/** Giữa, nhích lên, nhích xuống — cho tên khu vực. */
export const centered = (step: number): LabelCandidate[] => [
  { dx: 0, dy: 0, alignX: 0, alignY: 0 },
  { dx: 0, dy: -step, alignX: 0, alignY: 0 },
  { dx: 0, dy: step, alignX: 0, alignY: 0 },
];

const overlaps = (a: BBox, b: BBox) =>
  a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

/** Hộp vuông cạnh `2r` px quanh một điểm (m). */
export const markerBox = (p: Point, r: number, scale: number): BBox => ({
  minX: p.x - r / scale,
  minY: p.y - r / scale,
  maxX: p.x + r / scale,
  maxY: p.y + r / scale,
});

export function placeLabels(
  requests: readonly LabelRequest[],
  obstacles: readonly BBox[],
  scale: number,
  measure: MeasureText = measureText,
  padding = 2,
): PlacedLabel[] {
  const taken: BBox[] = [...obstacles];
  const out: PlacedLabel[] = [];
  const pad = padding / scale;
  for (const r of requests) {
    if (!r.text) continue;
    const w = measure(r.text, r.fontSize, !!r.bold) / scale;
    if (r.maxWidth !== undefined && w > r.maxWidth) continue;
    const h = (r.fontSize * 1.25) / scale;
    for (const c of r.candidates) {
      const ax = r.anchor.x + c.dx / scale;
      const ay = r.anchor.y + c.dy / scale;
      const x = c.alignX === 0 ? ax - w / 2 : c.alignX === 1 ? ax : ax - w;
      const y = c.alignY === 0 ? ay - h / 2 : c.alignY === 1 ? ay : ay - h;
      const box = { minX: x - pad, minY: y - pad, maxX: x + w + pad, maxY: y + h + pad };
      if (taken.some((t) => overlaps(t, box))) continue;
      taken.push(box);
      out.push({ key: r.key, text: r.text, x, y, width: w, height: h });
      break;
    }
  }
  return out;
}
