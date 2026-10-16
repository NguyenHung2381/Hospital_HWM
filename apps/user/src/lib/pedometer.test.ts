import { describe, expect, it } from 'vitest';
import { createStepDetector } from './pedometer';

const G = 9.81;

/** Tín hiệu đi bộ giả lập: dao động `amp` m/s² quanh trọng lực, `hz` bước/giây, lấy mẫu 60 Hz. */
function walk(seconds: number, hz: number, amp: number, noise = 0) {
  const samples: [number, number][] = [];
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let t = 0; t < seconds * 1000; t += 1000 / 60) {
    samples.push([G + amp * Math.sin((2 * Math.PI * hz * t) / 1000) + noise * rand(), t]);
  }
  return samples;
}

const count = (samples: [number, number][]) => {
  const detect = createStepDetector();
  return samples.filter(([m, t]) => detect(m, t)).length;
};

describe('createStepDetector', () => {
  it('đếm đúng số bước khi đi bộ đều', () => {
    expect(count(walk(10, 2, 3))).toBeGreaterThanOrEqual(19);
    expect(count(walk(10, 2, 3))).toBeLessThanOrEqual(20);
  });

  it('chịu được nhiễu nhỏ', () => {
    const n = count(walk(10, 1.8, 3, 0.4));
    expect(n).toBeGreaterThanOrEqual(16);
    expect(n).toBeLessThanOrEqual(19);
  });

  it('không đếm khi điện thoại đứng yên hoặc chỉ rung nhẹ', () => {
    expect(count(walk(10, 2, 0))).toBe(0);
    expect(count(walk(10, 5, 0.5, 0.3))).toBe(0);
  });
});
