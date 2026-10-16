import type { ReactNode } from 'react';
import {
  LANDMARK_KINDS,
  type DoorStyle,
  type ElevatorKind,
  type LandmarkKind,
  type WallKind,
} from '@hwn/map-core';
import { DOOR_STYLES, ELEVATOR_KINDS, WALL_KINDS } from '@hwn/map-render';
import { DOOR_STYLE_WIDTH, ELEVATOR_KIND_SIZE, WALL_KIND_DEFAULTS } from './ops';
import type { EditorState } from './store';
import { DOOR_STYLE_ICONS, ELEVATOR_KIND_ICONS, landmarkIcon, WALL_KIND_ICONS } from './tools';
import type { Tool } from './types';

/** Một lựa chọn trong menu kiểu/loại của công cụ. */
export interface ToolVariant {
  value: string;
  label: string;
  /** Thông số mặc định hiển thị bên phải (độ rộng, độ dày…). */
  detail?: string;
  icon: ReactNode;
}

/** Menu chọn kiểu/loại gắn với một nút công cụ (cửa đi, tường, thang máy, mốc). */
export interface ToolVariantMenu {
  title: string;
  options: ToolVariant[];
  current(s: EditorState): string;
  pick(s: EditorState, value: string): void;
  /** Nút công cụ hiện biểu tượng của lựa chọn hiện tại (thay cho biểu tượng chung). */
  showsCurrentIcon: boolean;
}

const m = (v: number) => `${v.toLocaleString('vi-VN')} m`;

const wallMenu = (showsCurrentIcon: boolean): ToolVariantMenu => ({
  title: 'Loại tường',
  options: WALL_KINDS.map((k) => {
    const d = WALL_KIND_DEFAULTS[k.value];
    return {
      ...k,
      detail: d.height ? `dày ${m(d.thickness)} · cao ${m(d.height)}` : `dày ${m(d.thickness)}`,
      icon: WALL_KIND_ICONS[k.value],
    };
  }),
  current: (s) => s.wallKind,
  pick: (s, v) => s.setWallKind(v as WallKind),
  showsCurrentIcon,
});

export const TOOL_VARIANTS: Partial<Record<Tool, ToolVariantMenu>> = {
  wall: wallMenu(true),
  wallRect: wallMenu(false),
  door: {
    title: 'Kiểu cửa đi',
    options: DOOR_STYLES.map((d) => ({
      ...d,
      detail: m(DOOR_STYLE_WIDTH[d.value]),
      icon: DOOR_STYLE_ICONS[d.value],
    })),
    current: (s) => s.doorStyle,
    pick: (s, v) => s.setDoorStyle(v as DoorStyle),
    showsCurrentIcon: true,
  },
  elevator: {
    title: 'Loại thang máy',
    options: ELEVATOR_KINDS.map((k) => {
      const d = ELEVATOR_KIND_SIZE[k.value];
      return {
        ...k,
        detail: `${d.width.toLocaleString('vi-VN')} × ${m(d.depth)}`,
        icon: ELEVATOR_KIND_ICONS[k.value],
      };
    }),
    current: (s) => s.elevatorKind,
    pick: (s, v) => s.setElevatorKind(v as ElevatorKind),
    showsCurrentIcon: true,
  },
  landmark: {
    title: 'Loại mốc',
    options: (Object.entries(LANDMARK_KINDS) as [LandmarkKind, string][]).map(([value, label]) => ({
      value,
      label,
      icon: landmarkIcon(value),
    })),
    current: (s) => s.landmarkKind,
    pick: (s, v) => s.setLandmarkKind(v as LandmarkKind),
    showsCurrentIcon: true,
  },
};

/** Chuyển công cụ `tool` sang lựa chọn tiếp theo trong menu của nó (nếu có). */
export function cycleVariant(s: EditorState, tool: Tool): boolean {
  const menu = TOOL_VARIANTS[tool];
  if (!menu) return false;
  const i = menu.options.findIndex((o) => o.value === menu.current(s));
  menu.pick(s, menu.options[(i + 1) % menu.options.length]!.value);
  return true;
}
