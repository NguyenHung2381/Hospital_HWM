import type { FloorRouteSegment, RouteStepGeometry } from '@hwn/map-render';
import { stepIndexAt } from '@hwn/map-render';

/** Người dùng đang ở đâu trên tuyến và đang xem bước nào. */
export interface NavProgress {
  step: number;
  segmentIndex: number;
  /** Quãng đường (m) tính từ đầu tuyến. */
  distance: number;
}

/** Vị trí khi bắt đầu bước `i`. */
export function progressAtStep(steps: readonly RouteStepGeometry[], i: number): NavProgress {
  const s = steps[i];
  return s
    ? { step: i, segmentIndex: s.segmentIndex, distance: s.begin }
    : { step: 0, segmentIndex: 0, distance: 0 };
}

/** Đang đứng ở cuối đoạn (trước thang hoặc tại điểm đến) — không thể đi tiếp trên đoạn này. */
export const atSegmentEnd = (p: NavProgress, track: readonly FloorRouteSegment[]) =>
  p.distance >= (track[p.segmentIndex]?.end ?? 0) - 1e-6;

/**
 * Đi thêm `meters` dọc tuyến. Dừng ở cuối đoạn: sang tầng khác cần người dùng xác nhận
 * (đi thang không tạo ra bước chân đáng tin cậy). Bước hiển thị chỉ tự tiến, không lùi.
 */
export function walk(
  p: NavProgress,
  meters: number,
  steps: readonly RouteStepGeometry[],
  track: readonly FloorRouteSegment[],
): NavProgress {
  const seg = track[p.segmentIndex];
  if (!seg) return p;
  const distance = Math.min(seg.end, p.distance + meters);
  const step = Math.max(p.step, stepIndexAt(steps, p.segmentIndex, distance));
  return { step, segmentIndex: p.segmentIndex, distance };
}
