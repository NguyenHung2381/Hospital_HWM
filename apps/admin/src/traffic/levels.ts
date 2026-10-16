import { useState } from 'react';

/** Ngưỡng số người trên một đoạn đường. */
export interface Thresholds {
  /** Từ mức này trở lên là "Đông". */
  busy: number;
  /** Từ mức này trở lên là "Quá tải". */
  overload: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { busy: 5, overload: 9 };
const STORAGE_KEY = 'hwn-traffic-thresholds';

function readThresholds(): Thresholds {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const t = JSON.parse(raw) as Partial<Thresholds>;
      if (Number(t.busy) > 0 && Number(t.overload) > Number(t.busy)) {
        return { busy: Number(t.busy), overload: Number(t.overload) };
      }
    }
  } catch {
    // localStorage không khả dụng → dùng mặc định.
  }
  return DEFAULT_THRESHOLDS;
}

/** Ngưỡng do từng người xem tự chỉnh, nhớ trong trình duyệt của họ. */
export function useThresholds(): [Thresholds, (t: Thresholds) => void] {
  const [value, setValue] = useState(readThresholds);
  const update = (t: Thresholds) => {
    setValue(t);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
    } catch {
      // Bỏ qua: chỉ là tiện ích ghi nhớ.
    }
  };
  return [value, update];
}

export type Level = 'normal' | 'busy' | 'overload';

export const levelOf = (count: number, t: Thresholds): Level =>
  count >= t.overload ? 'overload' : count >= t.busy ? 'busy' : 'normal';

/** Màu trạng thái cố định — luôn đi kèm icon + chữ, không dùng màu một mình. */
export const LEVEL_STYLE: Record<Level, { label: string; color: string }> = {
  normal: { label: 'Bình thường', color: '#0ca30c' },
  busy: { label: 'Đông', color: '#fab219' },
  overload: { label: 'Quá tải', color: '#d03b3b' },
};

/**
 * Thang màu tuần tự một sắc (xanh dương) cho heatmap, 5 mức. Đã kiểm tra bằng validator:
 * đơn sắc, độ sáng đơn điệu, các mức tách biệt, mức thấp nhất vẫn tách khỏi nền.
 * Theme tối dùng bước riêng (đậm → sáng) để mức thấp chìm vào nền tối.
 */
export const HEAT_RAMP = {
  light: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'],
  dark: ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4'],
} as const;

/**
 * Mức 0..4 của heatmap (-1 = không có ai). Mức cao nhất (4) trùng đúng ngưỡng quá tải, 4 mức
 * dưới chia đều khoảng [1, quá tải − 1].
 */
export function heatBin(count: number, t: Thresholds): number {
  if (count <= 0) return -1;
  if (count >= t.overload) return 4;
  const width = (t.overload - 1) / 4;
  return Math.min(3, Math.floor((count - 1) / width));
}

/** Khoảng số người của từng mức heatmap (cho chú giải). */
export function heatBinRanges(t: Thresholds): string[] {
  const ranges: string[] = [];
  for (let bin = 0; bin < 4; bin++) {
    // Các giá trị nguyên rơi vào mức này.
    const values: number[] = [];
    for (let c = 1; c < t.overload; c++) if (heatBin(c, t) === bin) values.push(c);
    ranges.push(
      values.length === 0
        ? '—'
        : values.length === 1
          ? String(values[0])
          : `${values[0]}–${values[values.length - 1]}`,
    );
  }
  ranges.push(`≥ ${t.overload}`);
  return ranges;
}
