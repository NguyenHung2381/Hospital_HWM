/**
 * Thu nhỏ ảnh (cạnh dài ≤ `maxSize`) và nén JPEG trước khi gửi lên server định vị —
 * ảnh gốc từ điện thoại thường 3–10 MB, mạng 4G trong viện có thể chậm.
 */
export async function compressImage(source: Blob, maxSize = 1280, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  try {
    return await drawToJpeg(bitmap, bitmap.width, bitmap.height, maxSize, quality);
  } finally {
    bitmap.close();
  }
}

export function drawToJpeg(
  image: CanvasImageSource,
  width: number,
  height: number,
  maxSize: number,
  quality = 0.85,
): Promise<Blob> {
  const k = Math.min(1, maxSize / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * k);
  canvas.height = Math.round(height * k);
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Không nén được ảnh'))),
      'image/jpeg',
      quality,
    ),
  );
}
