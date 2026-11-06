/** Ảnh nền mặt bằng của tầng: tải ảnh, tính khung bao theo mét. */
import { useEffect, useState } from 'react';
import { boundsOf, rotatePoint, type BBox, type FloorBackground } from '@hwn/map-core';

export function useImage(url: string | undefined) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) return;
    const img = new window.Image();
    img.onload = () => setImage(img);
    img.src = url;
    return () => {
      img.onload = null;
      setImage(null);
    };
  }, [url]);
  return url ? image : null;
}

const inkCache = new Map<string, Promise<HTMLCanvasElement>>();

/**
 * Ảnh bản vẽ đen trắng (nét tối trên giấy sáng) đổi thành nét màu `ink` trên nền trong suốt: độ đậm của nét
 * thành độ phủ, giấy trắng biến mất — nền tầng / theme hiện qua, bản vẽ chỉ còn là nét màu nhạt.
 */
function inkImage(url: string, ink: string): Promise<HTMLCanvasElement> {
  const key = `${url}|${ink}`;
  let p = inkCache.get(key);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, img.width, img.height);
        const px = data.data;
        const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(ink);
        const [r, g, b] = m ? [1, 2, 3].map((i) => parseInt(m[i]!, 16)) : [0, 0, 0];
        // Ảnh màu (ảnh vệ tinh, ảnh chụp) giữ nguyên — chỉ bản vẽ đen trắng mới đổi màu nét.
        let colour = 0;
        let n = 0;
        for (let i = 0; i < px.length; i += 4 * 97) {
          colour += Math.abs(px[i]! - px[i + 1]!) + Math.abs(px[i + 1]! - px[i + 2]!);
          n++;
        }
        if (colour / Math.max(n, 1) > 12) {
          resolve(canvas);
          return;
        }
        for (let i = 0; i < px.length; i += 4) {
          const lum = (px[i]! * 299 + px[i + 1]! * 587 + px[i + 2]! * 114) / 1000;
          // Nét mảnh bị khử răng cưa thành xám nhạt — đẩy độ phủ lên cho nét vẫn liền.
          const a = Math.min(255, (255 - lum) * 1.6) * (px[i + 3]! / 255);
          px[i] = r!;
          px[i + 1] = g!;
          px[i + 2] = b!;
          px[i + 3] = a;
        }
        ctx.putImageData(data, 0, 0);
        resolve(canvas);
      };
      img.onerror = () => {
        inkCache.delete(key);
        reject(new Error(`Không tải được ảnh nền ${url}`));
      };
      img.src = url;
    });
    inkCache.set(key, p);
  }
  return p;
}

/** Ảnh nền đã đổi sang nét màu `ink` (xem `inkImage`); null khi chưa xong. */
export function useInkImage(url: string | undefined, ink: string) {
  const [image, setImage] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    inkImage(url, ink).then(
      (c) => alive && setImage(c),
      () => alive && setImage(null),
    );
    return () => {
      alive = false;
      setImage(null);
    };
  }, [url, ink]);
  return url ? image : null;
}

/** Khung bao (m) của ảnh nền đã tải — dùng căn khung nhìn cho tầng chưa vẽ gì. */
export function backgroundBounds(
  background: FloorBackground,
  image: { width: number; height: number },
): BBox {
  const k = background.metersPerPixel;
  const corners = [
    { x: 0, y: 0 },
    { x: image.width * k, y: 0 },
    { x: image.width * k, y: image.height * k },
    { x: 0, y: image.height * k },
  ].map((p) =>
    rotatePoint(
      { x: p.x + background.offset.x, y: p.y + background.offset.y },
      background.offset,
      background.rotation,
    ),
  );
  return boundsOf(corners)!;
}
