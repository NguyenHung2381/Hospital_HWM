import { useCallback, useEffect, useRef, useState } from 'react';
import { drawToJpeg } from './image';

export type CameraStatus =
  | 'idle'
  | 'starting'
  | 'ready'
  /** Người dùng từ chối quyền camera. */
  | 'denied'
  /** Thiết bị không có camera / camera đang bị app khác dùng. */
  | 'unavailable'
  /** Trang không chạy qua HTTPS → trình duyệt chặn camera. */
  | 'insecure'
  | 'error';

/**
 * Khung ngắm camera sau (getUserMedia). Tự tắt camera khi rời trang hoặc khi tab bị ẩn
 * (tiết kiệm pin), bật lại khi quay lại.
 */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');

  const stop = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (!window.isSecureContext) return setStatus('insecure');
    if (!navigator.mediaDevices?.getUserMedia) return setStatus('unavailable');
    setStatus('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      stop();
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined); // iOS: play() có thể từ chối khi chưa có tương tác
      }
      setStatus('ready');
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      setStatus(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'denied'
          : name === 'NotFoundError' ||
              name === 'OverconstrainedError' ||
              name === 'NotReadableError'
            ? 'unavailable'
            : 'error',
      );
    }
  }, [stop]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        stop();
        setStatus('idle');
      } else {
        void start();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [start, stop]);

  /** Chụp khung hình hiện tại thành JPEG (cạnh dài ≤ `maxSize`). */
  const capture = useCallback(async (maxSize = 1280): Promise<Blob | null> => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    return drawToJpeg(video, video.videoWidth, video.videoHeight, maxSize);
  }, []);

  return { videoRef, status, start, stop, capture };
}
