import { useEffect, useState } from 'react';

/**
 * La bàn từ cảm biến hướng (DeviceOrientationEvent):
 * - iOS Safari: `webkitCompassHeading` (độ, 0 = Bắc, theo chiều kim đồng hồ), cần xin quyền.
 * - Android Chrome: sự kiện `deviceorientationabsolute`, `alpha` tính ngược chiều kim đồng hồ.
 */

type OrientationPermission = 'granted' | 'denied';
type OrientationEventWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<OrientationPermission>;
};
type CompassEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };

export const orientationSupported = () =>
  typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;

/** iOS 13+ bắt buộc xin quyền, và phải gọi trong sự kiện chạm của người dùng. */
export async function requestOrientationPermission(): Promise<boolean> {
  if (!orientationSupported()) return false;
  const request = (DeviceOrientationEvent as OrientationEventWithPermission).requestPermission;
  if (!request) return true;
  try {
    return (await request()) === 'granted';
  } catch {
    return false;
  }
}

/** Hướng la bàn (độ, 0 = Bắc) từ một sự kiện, đã bù góc xoay màn hình. null nếu không đọc được. */
export function compassFromEvent(e: CompassEvent, screenAngle = 0): number | null {
  let heading: number | null = null;
  if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) {
    heading = e.webkitCompassHeading;
  } else if (e.absolute && typeof e.alpha === 'number') {
    heading = 360 - e.alpha;
  }
  if (heading === null) return null;
  return (((heading + screenAngle) % 360) + 360) % 360;
}

/**
 * Làm mượt góc (có xử lý chỗ nối 359° → 0°) bằng trung bình vector. Trả về hàm nhận góc mới,
 * trả về góc đã làm mượt.
 */
export function createAngleSmoother(factor = 0.25) {
  let x: number | null = null;
  let y = 0;
  return (deg: number): number => {
    const r = (deg * Math.PI) / 180;
    if (x === null) {
      x = Math.cos(r);
      y = Math.sin(r);
    } else {
      x += factor * (Math.cos(r) - x);
      y += factor * (Math.sin(r) - y);
    }
    return ((((Math.atan2(y, x) * 180) / Math.PI) % 360) + 360) % 360;
  };
}

/** Chênh lệch nhỏ nhất giữa hai góc (độ, 0..180). */
export const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

export type CompassStatus = 'off' | 'waiting' | 'active' | 'unavailable';

/** Chỉ cập nhật React khi hướng đổi ít nhất chừng này độ — tránh vẽ lại bản đồ liên tục. */
const MIN_CHANGE_DEG = 2;
const NO_SENSOR_AFTER_MS = 2500;

/** Hướng la bàn hiện tại (độ, 0 = Bắc), chỉ khi `enabled`. */
export function useCompass(enabled: boolean): { heading: number | null; status: CompassStatus } {
  const [heading, setHeading] = useState<number | null>(null);
  const [sensed, setSensed] = useState<'active' | 'unavailable' | null>(null);
  const [wasEnabled, setWasEnabled] = useState(enabled);
  if (wasEnabled !== enabled) {
    setWasEnabled(enabled);
    setSensed(null);
    setHeading(null);
  }

  useEffect(() => {
    if (!enabled || !orientationSupported()) return;
    const smooth = createAngleSmoother();
    let last: number | null = null;
    const handle = (e: Event) => {
      const raw = compassFromEvent(e as CompassEvent, window.screen?.orientation?.angle ?? 0);
      if (raw === null) return;
      const value = smooth(raw);
      if (last === null) setSensed('active');
      if (last === null || angleDiff(value, last) >= MIN_CHANGE_DEG) {
        last = value;
        setHeading(value);
      }
    };
    // Android có sự kiện "tuyệt đối" riêng; iOS dùng sự kiện thường kèm webkitCompassHeading.
    const type =
      'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(type, handle);
    const timer = window.setTimeout(() => {
      if (last === null) setSensed('unavailable');
    }, NO_SENSOR_AFTER_MS);
    return () => {
      window.removeEventListener(type, handle);
      window.clearTimeout(timer);
    };
  }, [enabled]);

  const status: CompassStatus = !enabled
    ? 'off'
    : !orientationSupported()
      ? 'unavailable'
      : (sensed ?? 'waiting');
  return { heading: enabled ? heading : null, status };
}
