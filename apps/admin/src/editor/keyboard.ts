/** Tiện ích bàn phím dùng chung cho các phím tắt của editor. */
import { useTransient } from './transient';

/** Đang gõ trong ô nhập liệu — không xử lý phím tắt. */
export const isTyping = (e: KeyboardEvent) =>
  e.target instanceof HTMLElement &&
  (e.target.isContentEditable || e.target.closest('input, textarea, select') !== null);

/** Đang mở hộp thoại (hướng dẫn…) — phím tắt của bản đồ tạm ngưng. */
export const inOverlay = (e: KeyboardEvent) =>
  useTransient.getState().helpOpen ||
  (e.target instanceof Element && e.target.closest('dialog') !== null);

/** Ký tự có dấu mà bộ gõ Telex gửi thay cho phím gốc khi gõ một mình. */
const VI_LETTERS: Record<string, string> = { ư: 'w', đ: 'd' };

/**
 * Chữ cái (thường) của phím bấm, không phụ thuộc bộ gõ / kiểu bàn phím: ưu tiên `e.code`
 * (KeyW → "w"). Bộ gõ tiếng Việt có thể gửi ký tự đã ghép (ư, đ) với `code` rỗng — quy về phím gốc.
 */
export function letterOf(e: KeyboardEvent): string | null {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
  const k = e.key.toLowerCase();
  return VI_LETTERS[k] ?? (/^[a-z]$/.test(k) ? k : null);
}

/**
 * Bộ gõ tiếng Việt (Unikey, EVKey…) ghép dấu bằng cách gửi Backspace giả rồi gửi ký tự có dấu ngay
 * sau đó — vd. gõ "dd" thành "đ". Nếu xử lý Backspace ngay sẽ lỡ tay xoá đối tượng / điểm vẽ.
 * Vì vậy hành động của Backspace được trì hoãn một chút và huỷ nếu ngay sau đó có ký tự có dấu.
 */
const IME_WINDOW_MS = 40;
let pendingBackspace: ReturnType<typeof setTimeout> | undefined;

export function onBackspace(action: () => void) {
  clearTimeout(pendingBackspace);
  pendingBackspace = setTimeout(action, IME_WINDOW_MS);
}

if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key.length === 1 && e.key.charCodeAt(0) > 127) clearTimeout(pendingBackspace);
    },
    true,
  );
}
