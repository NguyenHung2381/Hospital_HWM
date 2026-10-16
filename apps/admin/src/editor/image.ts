/**
 * Đọc ảnh mặt bằng người dùng tải lên, thu nhỏ (cạnh dài tối đa `maxSize` px) và nén JPEG
 * thành data URL để lưu kèm dữ liệu tầng.
 *
 * TODO(server): khi có backend, nên upload file lên kho lưu trữ và chỉ lưu URL trong `Floor.background`.
 */
export async function readImageAsDataUrl(
  file: File,
  maxSize = 2048,
): Promise<{ url: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * k);
  const height = Math.round(bitmap.height * k);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  // Nền trắng cho ảnh PNG trong suốt (JPEG không có kênh alpha).
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { url: canvas.toDataURL('image/jpeg', 0.85), width, height };
}
