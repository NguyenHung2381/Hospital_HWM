import type { Id } from './types';

/** Tạo ID ngắn có tiền tố dễ đọc, ví dụ `wall_3f9a1c2b`. */
export function createId(prefix: string): Id {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${random}`;
}
