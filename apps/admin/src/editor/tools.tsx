import type { ReactNode } from 'react';
import type { DoorStyle, ElevatorKind, LandmarkKind, WallKind } from '@hwn/map-core';
import { LANDMARK_STYLE } from '@hwn/map-render';
import type { Tool } from './types';

const icon = (children: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {children}
  </svg>
);

export interface ToolDef {
  tool: Tool;
  label: string;
  key: string;
  icon: ReactNode;
  hint: string;
}

export const TOOL_GROUPS: ToolDef[][] = [
  [
    {
      tool: 'select',
      label: 'Chọn',
      key: 'V',
      icon: icon(<path d="M5 3l13 8-6 1.5L9 19z" />),
      hint: 'Click để chọn · Shift+click chọn thêm · Kéo để di chuyển · Kéo chấm tròn để sửa đầu tường · Delete để xoá',
    },
    {
      tool: 'pan',
      label: 'Di chuyển bản đồ',
      key: 'H',
      icon: icon(
        <>
          <path d="M12 3v18M3 12h18" />
          <path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
        </>,
      ),
      hint: 'Kéo để di chuyển bản đồ',
    },
  ],
  [
    {
      tool: 'wall',
      label: 'Tường',
      key: 'W',
      icon: icon(<path d="M4 20V8h16" strokeWidth="4" strokeLinecap="square" />),
      hint: 'Chọn loại tường (gạch, bê tông, vách ngăn…) ở menu cạnh nút · Nhấn W lần nữa để đổi loại · Click để đặt từng điểm · Gõ số + Enter để vẽ đúng chiều dài · Shift: bật/tắt khoá góc · Alt: tạm tắt bắt dính · Backspace: bỏ điểm cuối · Double-click / Enter để kết thúc',
    },
    {
      tool: 'wallRect',
      label: 'Tường chữ nhật',
      key: 'B',
      icon: icon(
        <>
          <rect x="4" y="5" width="16" height="14" strokeWidth="3" />
          <circle cx="4" cy="5" r="1.5" fill="currentColor" />
          <circle cx="20" cy="19" r="1.5" fill="currentColor" />
        </>,
      ),
      hint: 'Loại tường chọn ở menu cạnh nút (dùng chung với công cụ Tường) · Click góc thứ nhất rồi click góc đối diện để tạo 4 bức tường (kèm phòng nếu bật trong Cài đặt) · Shift: hình vuông · Alt: tạm tắt bắt dính · Esc để huỷ',
    },
    {
      tool: 'door',
      label: 'Cửa đi',
      key: 'D',
      icon: icon(
        <>
          <path d="M3 20h4M17 20h4" strokeWidth="3" />
          <path d="M7 20V8" />
          <path d="M7 8a12 12 0 0 1 10 12" strokeDasharray="2 2" />
        </>,
      ),
      hint: 'Chọn kiểu cửa (1 cánh, 2 cánh, cửa lùa…) ở menu cạnh nút · Nhấn D lần nữa để đổi kiểu · Rê chuột gần tường rồi click để đặt cửa (màu đỏ = chồng lên cửa khác)',
    },
    {
      tool: 'window',
      label: 'Cửa sổ',
      key: 'N',
      icon: icon(
        <>
          <rect x="3" y="9" width="18" height="6" />
          <path d="M3 12h18" />
        </>,
      ),
      hint: 'Rê chuột gần tường rồi click để đặt cửa sổ',
    },
    {
      tool: 'entrance',
      label: 'Cửa ra vào chính',
      key: 'E',
      icon: icon(
        <>
          <path d="M3 4h4M17 4h4" strokeWidth="3" />
          <path d="M12 21V8M8 12l4-4 4 4" />
        </>,
      ),
      hint: 'Rê chuột gần tường bao rồi click để đặt cửa ra vào chính',
    },
  ],
  [
    {
      tool: 'elevator',
      label: 'Thang máy',
      key: 'L',
      icon: icon(
        <>
          <rect x="4" y="3" width="16" height="18" rx="1" />
          <path d="M9 10l3-3 3 3M9 14l3 3 3-3" />
        </>,
      ),
      hint: 'Chọn loại thang máy (thường, ưu tiên, chở bệnh nhân…) ở menu cạnh nút · Nhấn L lần nữa để đổi loại · Click để đặt thang máy · Chỉnh kích thước và nối tầng ở bảng bên phải',
    },
    {
      tool: 'stairs',
      label: 'Thang bộ',
      key: 'S',
      icon: icon(<path d="M3 20h5v-5h5v-5h5V5h3" />),
      hint: 'Click để đặt thang bộ · Chỉnh kích thước và nối tầng ở bảng bên phải',
    },
    {
      tool: 'escalator',
      label: 'Thang cuốn',
      key: 'K',
      icon: icon(
        <>
          <path d="M3 19h4l10-12h4" />
          <path d="M3 15h3l9-11" opacity="0.5" />
        </>,
      ),
      hint: 'Click để đặt thang cuốn · Chọn chiều lên/xuống ở bảng bên phải',
    },
  ],
  [
    {
      tool: 'room',
      label: 'Vẽ phòng (đa giác)',
      key: 'R',
      icon: icon(
        <>
          <path d="M4 5h11l5 6v8H4z" fill="currentColor" fillOpacity="0.15" />
          <circle cx="4" cy="5" r="1.5" fill="currentColor" />
          <circle cx="15" cy="5" r="1.5" fill="currentColor" />
          <circle cx="20" cy="11" r="1.5" fill="currentColor" />
        </>,
      ),
      hint: 'Click từng đỉnh (bắt dính vào góc tường) · Gõ số + Enter để đặt đỉnh theo chiều dài · Backspace: bỏ đỉnh cuối · Click lại đỉnh đầu hoặc Enter để khép phòng · Esc để huỷ',
    },
    {
      tool: 'roomAuto',
      label: 'Tạo phòng từ vùng kín',
      key: 'F',
      icon: icon(
        <>
          <rect x="3" y="4" width="18" height="16" />
          <path d="M3 12h18M12 4v8" />
          <path d="M14 14l5 5M15 19h4v-4" />
        </>,
      ),
      hint: 'Click vào bên trong một vùng có tường bao quanh để tạo phòng (xanh = sẽ tạo, xám = đã là phòng)',
    },
    {
      tool: 'landmark',
      label: 'Mốc (tiện ích)',
      key: 'O',
      icon: icon(
        <>
          <path d="M12 21s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11z" />
          <circle cx="12" cy="10" r="2" fill="currentColor" />
        </>,
      ),
      hint: 'Chọn loại mốc (quầy thông tin, máy lấy số, ATM, nhà vệ sinh…) ở menu cạnh nút · Nhấn O lần nữa để đổi loại · Click để đặt mốc · Sửa tên ở bảng bên phải · Người dùng tìm được và được chỉ đường tới mốc',
    },
    {
      tool: 'furniture',
      label: 'Nội thất & thiết bị',
      key: 'I',
      icon: icon(
        <>
          <rect x="6" y="3" width="12" height="18" rx="1.5" />
          <rect x="8" y="5" width="8" height="3" rx="1" fill="currentColor" fillOpacity="0.3" />
          <path d="M6 11h12" />
        </>,
      ),
      hint: 'Chọn ký hiệu (giường bệnh, ghế chờ, máy chụp…) ở menu cạnh nút · Nhấn I lần nữa để đổi loại · Click để đặt — gần tường thì tự quay lưng vào tường và áp sát · Shift+R: xoay 90° trước khi đặt · Alt: đặt tự do · Sửa kích thước, góc xoay ở bảng bên phải',
    },
  ],
  [
    {
      tool: 'navNode',
      label: 'Điểm đồ thị đi lại',
      key: 'P',
      icon: icon(
        <>
          <circle cx="12" cy="12" r="4" fill="currentColor" fillOpacity="0.3" />
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
        </>,
      ),
      hint: 'Click để thêm điểm hành lang · Click vào điểm có sẵn để chọn',
    },
    {
      tool: 'navEdge',
      label: 'Nối đồ thị đi lại',
      key: 'J',
      icon: icon(
        <>
          <circle cx="5" cy="18" r="2.5" />
          <circle cx="19" cy="6" r="2.5" />
          <path d="M7 16L17 8" strokeDasharray="3 2" />
        </>,
      ),
      hint: 'Click lần lượt các điểm để nối (click chỗ trống = tạo điểm mới) · Click lại điểm cuối / Enter / Esc để dừng',
    },
  ],
  [
    {
      tool: 'measure',
      label: 'Thước đo',
      key: 'T',
      icon: icon(
        <>
          <path d="M4 12h16" />
          <path d="M4 8v8M20 8v8M8 12v-2M12 12v-3M16 12v-2" />
        </>,
      ),
      hint: 'Click 2 điểm để đo khoảng cách (không thay đổi bản đồ) · Click tiếp để đo lại · Shift: khoá góc 45° · Esc để xoá',
    },
    {
      tool: 'dimension',
      label: 'Ghi kích thước',
      key: 'Q',
      icon: icon(
        <>
          <path d="M4 7v10M20 7v10M4 12h16" />
          <path d="M6 14l4-4M14 14l4-4" />
        </>,
      ),
      hint: 'Click 2 điểm cần ghi kích thước (bắt dính đầu / thân tường) · Di chuột để đặt đường kích thước rồi click lần 3 · Shift: khoá góc 45° · Backspace: bỏ điểm cuối · Esc để huỷ',
    },
    {
      tool: 'text',
      label: 'Chú thích chữ',
      key: 'X',
      icon: icon(
        <>
          <path d="M5 7V5h14v2" />
          <path d="M12 5v14M9 19h6" />
        </>,
      ),
      hint: 'Click để đặt chú thích · Sửa nội dung, cỡ chữ, góc xoay ở bảng bên phải',
    },
    {
      tool: 'calibrate',
      label: 'Hiệu chỉnh tỉ lệ ảnh nền',
      key: 'M',
      icon: icon(
        <>
          <path d="M3 17L17 3l4 4L7 21z" />
          <path d="M7 13l2 2M10 10l2 2M13 7l2 2" />
        </>,
      ),
      hint: 'Click 2 điểm trên ảnh nền có khoảng cách đã biết, rồi nhập khoảng cách thực ở bảng bên phải',
    },
  ],
];

export const ALL_TOOLS = TOOL_GROUPS.flat();

/** Biểu tượng từng kiểu cánh cửa đi (nút cửa đi trên thanh công cụ hiện kiểu đang chọn). */
export const DOOR_STYLE_ICONS: Record<DoorStyle, ReactNode> = {
  single: toolDefIcon('door'),
  double: icon(
    <>
      <path d="M2 20h3M19 20h3" strokeWidth="3" />
      <path d="M5 20v-7M19 20v-7" />
      <path d="M5 13a7 7 0 0 1 7 7M19 13a7 7 0 0 0-7 7" strokeDasharray="2 2" />
    </>,
  ),
  sliding: icon(
    <>
      <path d="M2 11h5M17 11h5" strokeWidth="3" />
      <path d="M4 15h11" strokeWidth="2.5" />
      <path d="M11 20H5M7 18l-2 2 2 2" />
    </>,
  ),
  automatic: icon(
    <>
      <path d="M2 11h4M18 11h4" strokeWidth="3" />
      <path d="M3 15h6M15 15h6" strokeWidth="2.5" />
      <path d="M10 20H5M7 18l-2 2 2 2M14 20h5M17 18l2 2-2 2" />
    </>,
  ),
  opening: icon(
    <>
      <path d="M2 11h6M16 11h6" strokeWidth="3" />
      <path d="M8 7v8M16 7v8" />
      <path d="M8 11h8" strokeDasharray="2 2" />
    </>,
  ),
};

/** Biểu tượng từng loại tường (nút tường trên thanh công cụ hiện loại đang chọn). */
export const WALL_KIND_ICONS: Record<WallKind, ReactNode> = {
  brick: icon(
    <>
      <rect x="3" y="7" width="18" height="10" />
      <path d="M3 12h18M9 7v5M15 7v5M6 12v5M12 12v5M18 12v5" strokeWidth="1.5" />
    </>,
  ),
  concrete: icon(
    <>
      <rect x="3" y="7" width="18" height="10" fill="currentColor" fillOpacity="0.2" />
      <path d="M4 17l7.5-10M10 17l7.5-10M16 17l5-6.7" strokeWidth="1.5" />
    </>,
  ),
  partition: icon(
    <>
      <rect x="3" y="10" width="18" height="4" />
      <path d="M7.5 10v4M12 10v4M16.5 10v4" strokeWidth="1.5" />
    </>,
  ),
  glass: icon(
    <>
      <rect x="3" y="8" width="18" height="8" fill="currentColor" fillOpacity="0.12" />
      <path d="M7 14l3-4M12 14l3-4" strokeWidth="1.5" />
    </>,
  ),
  railing: icon(
    <>
      <path d="M3 8h18" strokeWidth="2.5" />
      <path d="M3 19h18" strokeOpacity="0.5" />
      <path d="M5 8v11M9.7 8v11M14.3 8v11M19 8v11" strokeWidth="1.5" />
    </>,
  ),
};

const elevatorIcon = (inner: ReactNode) =>
  icon(
    <>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      {inner}
    </>,
  );

/** Biểu tượng từng loại thang máy (nút thang máy trên thanh công cụ hiện loại đang chọn). */
export const ELEVATOR_KIND_ICONS: Record<ElevatorKind, ReactNode> = {
  passenger: toolDefIcon('elevator'),
  priority: elevatorIcon(
    <>
      <circle cx="11" cy="6.8" r="1.3" fill="currentColor" stroke="none" />
      <path d="M11 9.5v4.5h3.5l1.5 3.5" strokeWidth="1.6" />
      <path d="M9 12.2a3.6 3.6 0 1 0 5.2 4.6" strokeWidth="1.6" />
    </>,
  ),
  bed: elevatorIcon(
    <>
      <path d="M7.5 9v8M7.5 14h9v3" strokeWidth="1.6" />
      <path d="M9 12h2.5" strokeWidth="2.2" />
    </>,
  ),
  service: elevatorIcon(
    <>
      <rect x="8" y="9.5" width="8" height="7" strokeWidth="1.6" />
      <path d="M8 12.5h8M12 9.5v3" strokeWidth="1.4" />
    </>,
  ),
};

/** Biểu tượng mốc: chấm tròn màu của loại mốc với hình vẽ trắng (giống trên bản đồ). */
export function landmarkIcon(kind: LandmarkKind) {
  const style = LANDMARK_STYLE[kind];
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <circle cx="12" cy="12" r="11" fill={style.color} />
      <path
        d={style.icon}
        transform="translate(5 5) scale(0.5833)"
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function toolDefIcon(tool: Tool) {
  return ALL_TOOLS.find((t) => t.tool === tool)!.icon;
}

/** Công cụ ứng với phím chữ (theo `KeyboardEvent.code`, không phụ thuộc bộ gõ). */
export const toolForLetter = (letter: string) =>
  ALL_TOOLS.find((t) => t.key.toLowerCase() === letter);
export const toolDef = (tool: Tool) => ALL_TOOLS.find((t) => t.tool === tool)!;
