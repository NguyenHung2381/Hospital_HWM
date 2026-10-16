import { create } from 'zustand';
import type { Point } from '@hwn/map-core';
import type { SnapKind } from './snap';

/**
 * Trạng thái tạm thời, thay đổi liên tục khi rê chuột — tách khỏi store chính
 * để chỉ các thành phần nhỏ (thanh trạng thái, bảng hiệu chỉnh) render lại.
 */
interface TransientState {
  cursor: Point | null;
  snapKind: SnapKind | null;
  /** Hai điểm đo khi hiệu chỉnh tỉ lệ ảnh nền. */
  calibration: Point[];
  /** Số điểm của chuỗi tường / đa giác phòng đang vẽ. */
  chainLength: number;
  /** Chiều dài đang gõ khi vẽ (vd. "3.5"), rỗng nếu không gõ. */
  lengthInput: string;
  /** Kết quả thước đo (m), null nếu chưa đo. */
  measure: { distance: number; dx: number; dy: number } | null;
  /** Đang mở hộp thoại hướng dẫn. */
  helpOpen: boolean;
  patch(p: Partial<Omit<TransientState, 'patch'>>): void;
}

export const useTransient = create<TransientState>((set) => ({
  cursor: null,
  snapKind: null,
  calibration: [],
  chainLength: 0,
  lengthInput: '',
  measure: null,
  helpOpen: false,
  patch: (p) => set(p),
}));
