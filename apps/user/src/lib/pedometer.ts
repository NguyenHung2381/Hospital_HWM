import { useEffect, useEffectEvent, useState } from 'react';

/**
 * Đếm bước chân từ cảm biến gia tốc (DeviceMotionEvent) — cách định vị tương đối phổ biến
 * trong nhà (PDR) khi không có GPS. Ta không cần biết hướng đi: vị trí được "khớp" vào
 * tuyến đường đang đi, nên chỉ cần số bước × độ dài bước.
 */

/** Độ dài bước trung bình của người lớn (m). */
export const STRIDE_METERS = 0.7;

export interface StepDetectorOptions {
  /** Vượt baseline bao nhiêu m/s² thì coi là đỉnh bước. */
  riseThreshold?: number;
  /** Xuống dưới mức này (so với baseline) mới cho phép đếm bước tiếp theo. */
  fallThreshold?: number;
  /** Khoảng cách tối thiểu giữa 2 bước (ms) — người đi bộ nhanh ~ 2.5 bước/giây. */
  minIntervalMs?: number;
}

/**
 * Bộ phát hiện bước: làm mượt độ lớn gia tốc, trừ đi đường nền (trọng lực + nhiễu chậm),
 * đếm mỗi lần tín hiệu vượt ngưỡng lên rồi rơi xuống (có trễ để không đếm 2 lần).
 */
export function createStepDetector({
  riseThreshold = 1.1,
  fallThreshold = 0.2,
  minIntervalMs = 280,
}: StepDetectorOptions = {}) {
  let fast: number | null = null;
  let baseline: number | null = null;
  let armed = true;
  let lastStepAt = -Infinity;

  /** Đưa vào một mẫu (độ lớn gia tốc m/s², thời điểm ms); trả về true nếu vừa xong một bước. */
  return (magnitude: number, timeMs: number): boolean => {
    fast = fast === null ? magnitude : fast + 0.35 * (magnitude - fast);
    baseline = baseline === null ? magnitude : baseline + 0.02 * (magnitude - baseline);
    const signal = fast - baseline;
    if (armed && signal > riseThreshold && timeMs - lastStepAt >= minIntervalMs) {
      armed = false;
      lastStepAt = timeMs;
      return true;
    }
    if (!armed && signal < fallThreshold) armed = true;
    return false;
  };
}

type MotionPermission = 'granted' | 'denied';
type MotionEventWithPermission = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<MotionPermission>;
};

export const motionSupported = () => typeof window !== 'undefined' && 'DeviceMotionEvent' in window;

/** iOS 13+ bắt buộc xin quyền, và phải gọi trong sự kiện chạm của người dùng. */
export async function requestMotionPermission(): Promise<boolean> {
  if (!motionSupported()) return false;
  const request = (DeviceMotionEvent as MotionEventWithPermission).requestPermission;
  if (!request) return true;
  try {
    return (await request()) === 'granted';
  } catch {
    return false;
  }
}

export type PedometerStatus = 'off' | 'waiting' | 'active' | 'unavailable';

/** Không có mẫu cảm biến nào sau khoảng này (ms) => coi như thiết bị không có cảm biến. */
const NO_SENSOR_AFTER_MS = 2500;

/** Gọi `onStep` mỗi khi phát hiện một bước chân, chỉ khi `enabled`. */
export function usePedometer(enabled: boolean, onStep: () => void): PedometerStatus {
  // Kết quả dò cảm biến của lần bật gần nhất; xoá khi bật/tắt lại.
  const [sensed, setSensed] = useState<'active' | 'unavailable' | null>(null);
  const [wasEnabled, setWasEnabled] = useState(enabled);
  if (wasEnabled !== enabled) {
    setWasEnabled(enabled);
    setSensed(null);
  }
  const step = useEffectEvent(onStep);

  useEffect(() => {
    if (!enabled || !motionSupported()) return;
    const detect = createStepDetector();
    let gotSample = false;
    const handle = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (a?.x == null || a.y == null || a.z == null) return;
      if (!gotSample) {
        gotSample = true;
        setSensed('active');
      }
      if (detect(Math.hypot(a.x, a.y, a.z), e.timeStamp)) step();
    };
    window.addEventListener('devicemotion', handle);
    const timer = window.setTimeout(() => {
      if (!gotSample) setSensed('unavailable');
    }, NO_SENSOR_AFTER_MS);
    return () => {
      window.removeEventListener('devicemotion', handle);
      window.clearTimeout(timer);
    };
  }, [enabled]);

  if (!enabled) return 'off';
  if (!motionSupported()) return 'unavailable';
  return sensed ?? 'waiting';
}
