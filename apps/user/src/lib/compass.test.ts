import { describe, expect, it } from 'vitest';
import { angleDiff, compassFromEvent, createAngleSmoother } from './compass';

const event = (props: Record<string, unknown>) => props as unknown as DeviceOrientationEvent;

describe('compassFromEvent', () => {
  it('iOS: dùng webkitCompassHeading', () => {
    expect(compassFromEvent(event({ webkitCompassHeading: 45, alpha: 10, absolute: false }))).toBe(
      45,
    );
  });

  it('Android: alpha tuyệt đối tính ngược chiều kim đồng hồ', () => {
    expect(compassFromEvent(event({ alpha: 90, absolute: true }))).toBe(270);
  });

  it('bù góc xoay màn hình, bỏ qua dữ liệu không tuyệt đối', () => {
    expect(compassFromEvent(event({ webkitCompassHeading: 350 }), 90)).toBe(80);
    expect(compassFromEvent(event({ alpha: 90, absolute: false }))).toBeNull();
  });
});

describe('createAngleSmoother', () => {
  it('làm mượt qua chỗ nối 359° → 0° mà không quay vòng ngược', () => {
    const smooth = createAngleSmoother(0.5);
    smooth(350);
    const v = smooth(10);
    expect(angleDiff(v, 0)).toBeLessThan(1);
  });
});
