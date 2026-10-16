import { describe, expect, it } from 'vitest';
import { heatBin, heatBinRanges, levelOf } from './levels';

const t = { busy: 5, overload: 10 };

describe('mức lưu lượng', () => {
  it('phân loại theo ngưỡng', () => {
    expect(levelOf(0, t)).toBe('normal');
    expect(levelOf(4, t)).toBe('normal');
    expect(levelOf(5, t)).toBe('busy');
    expect(levelOf(10, t)).toBe('overload');
  });

  it('chia 5 mức heatmap; mức cao nhất trùng ngưỡng quá tải', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 25].map((c) => heatBin(c, t))).toEqual([
      -1, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4,
    ]);
    expect(heatBinRanges(t)).toEqual(['1–3', '4–5', '6–7', '8–9', '≥ 10']);
    expect(heatBinRanges({ busy: 1, overload: 2 })).toEqual(['1', '—', '—', '—', '≥ 2']);
  });
});
