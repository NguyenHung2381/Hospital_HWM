/**
 * Thư viện ký hiệu nội thất / thiết bị y tế: kích thước, chiều cao và hình vẽ — dùng chung cho mặt
 * bằng 2D, khối 3D, biểu tượng menu và bản xuất của editor.
 */
import type { FurnitureKind } from '@hwn/map-core';

export interface FurnitureDef {
  label: string;
  /** Kích thước mặc định (m): bề ngang × chiều sâu (sâu = từ lưng ra trước). */
  width: number;
  depth: number;
  /** Chiều cao thân (m) — dựng khối 3D. */
  height: number;
  /** Chiều cao phần đậm (lưng ghế, đầu giường, màn hình, cột…). Mặc định 1,6 × `height`. */
  solidHeight?: number;
  /** Hình vẽ trong ô đơn vị: u, v ∈ [-0.5, 0.5] (nhân với bề ngang / chiều sâu); lưng ở v = -0.5. */
  shapes: UnitShape[];
}

/** Kiểu tô: nền (che lưới / màu phòng), đậm (lưng ghế, đầu giường), nhạt (gối, nệm). */
export type ShapeFill = 'base' | 'solid' | 'soft';

type UnitShape =
  | {
      kind: 'rect';
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      fill?: ShapeFill;
      round?: boolean;
      /** Cao độ đáy / đỉnh (m) thay cho mặc định theo kiểu tô. */
      z?: [number, number];
    }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill?: ShapeFill }
  | { kind: 'line'; points: number[] };

const R = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  fill?: ShapeFill,
  round = false,
  z?: [number, number],
): UnitShape => ({ kind: 'rect', x0, y0, x1, y1, fill, round, z });
const E = (cx: number, cy: number, rx: number, ry: number, fill?: ShapeFill): UnitShape => ({
  kind: 'ellipse',
  cx,
  cy,
  rx,
  ry,
  fill,
});
const L = (...points: number[]): UnitShape => ({ kind: 'line', points });

/** Ba ghế liền nhau có chung thanh tựa lưng. */
const seats = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    R(-0.5 + i / n + 0.02, -0.3, -0.5 + (i + 1) / n - 0.02, 0.5, 'base', true),
  );

export const FURNITURE: Record<FurnitureKind, FurnitureDef> = {
  bed: {
    label: 'Giường bệnh',
    width: 0.9,
    depth: 2,
    height: 0.55,
    shapes: [
      R(-0.5, -0.5, 0.5, 0.5, 'base'),
      R(-0.38, -0.46, 0.38, -0.32, 'soft', true),
      L(-0.5, -0.2, 0.5, -0.2),
      L(-0.5, 0.05, 0.5, -0.2),
    ],
  },
  icuBed: {
    label: 'Giường hồi sức (ICU)',
    width: 1,
    depth: 2.2,
    height: 0.6,
    solidHeight: 0.95,
    shapes: [
      R(-0.5, -0.5, 0.5, 0.5, 'base'),
      R(-0.5, -0.5, 0.5, -0.45, 'solid'),
      R(-0.34, -0.42, 0.34, -0.3, 'soft', true),
      R(-0.47, -0.25, -0.42, 0.3, 'solid'),
      R(0.42, -0.25, 0.47, 0.3, 'solid'),
      L(-0.42, -0.2, 0.42, -0.2),
    ],
  },
  crib: {
    label: 'Nôi sơ sinh',
    width: 0.55,
    depth: 0.95,
    height: 0.9,
    shapes: [R(-0.5, -0.5, 0.5, 0.5, 'base', true), R(-0.38, -0.42, 0.38, 0.42, 'soft', true)],
  },
  stretcher: {
    label: 'Cáng / xe đẩy',
    width: 0.65,
    depth: 1.95,
    height: 0.8,
    shapes: [
      R(-0.5, -0.5, 0.5, 0.5, 'base', true),
      R(-0.3, -0.45, 0.3, -0.36, 'soft', true),
      L(-0.38, -0.3, -0.38, 0.42),
      L(0.38, -0.3, 0.38, 0.42),
    ],
  },
  examTable: {
    label: 'Giường khám',
    width: 0.7,
    depth: 1.9,
    height: 0.75,
    shapes: [
      R(-0.5, -0.5, 0.5, 0.5, 'base', true),
      R(-0.5, -0.5, 0.5, -0.3, 'soft', true),
      L(-0.5, 0.2, 0.5, 0.2),
    ],
  },
  chair: {
    label: 'Ghế',
    width: 0.5,
    depth: 0.5,
    height: 0.45,
    solidHeight: 0.9,
    shapes: [R(-0.42, -0.3, 0.42, 0.5, 'base', true), R(-0.5, -0.5, 0.5, -0.3, 'solid', true)],
  },
  chairRow: {
    label: 'Dãy ghế chờ (3 chỗ)',
    width: 1.8,
    depth: 0.6,
    height: 0.45,
    solidHeight: 0.9,
    shapes: [R(-0.5, -0.5, 0.5, -0.32, 'solid', true), ...seats(3)],
  },
  desk: {
    label: 'Bàn làm việc / bàn khám',
    width: 1.4,
    depth: 0.7,
    height: 0.75,
    solidHeight: 1.15,
    shapes: [R(-0.5, -0.5, 0.5, 0.5, 'base'), R(-0.2, -0.4, 0.2, -0.3, 'solid')],
  },
  counter: {
    label: 'Quầy tiếp đón',
    width: 2.4,
    depth: 0.8,
    height: 1.1,
    shapes: [R(-0.5, -0.5, 0.5, 0.5, 'base', true), R(-0.46, -0.42, 0.46, 0.05, 'soft')],
  },
  cabinet: {
    label: 'Tủ thuốc / tủ hồ sơ',
    width: 1,
    depth: 0.5,
    height: 1.8,
    shapes: [R(-0.5, -0.5, 0.5, 0.5, 'base'), L(-0.5, -0.5, 0.5, 0.5), L(-0.5, 0.5, 0.5, -0.5)],
  },
  dentalChair: {
    label: 'Ghế nha khoa',
    width: 0.8,
    depth: 1.9,
    height: 0.6,
    shapes: [
      E(0, -0.42, 0.22, 0.07, 'soft'),
      R(-0.36, -0.33, 0.36, 0.2, 'base', true),
      R(-0.26, 0.2, 0.26, 0.5, 'base', true),
      L(-0.5, -0.15, -0.36, -0.15, -0.36, 0.1),
      L(0.5, -0.15, 0.36, -0.15, 0.36, 0.1),
    ],
  },
  ultrasound: {
    label: 'Máy siêu âm',
    width: 0.6,
    depth: 0.6,
    height: 0.9,
    solidHeight: 1.4,
    shapes: [
      R(-0.5, -0.2, 0.5, 0.5, 'base', true),
      R(-0.4, -0.5, 0.4, -0.25, 'solid', true),
      E(0, 0.2, 0.2, 0.15),
    ],
  },
  xray: {
    label: 'Máy X-quang',
    width: 2.2,
    depth: 1.4,
    height: 0.75,
    solidHeight: 2,
    shapes: [
      R(-0.5, -0.5, 0.5, 0.5, 'base', true),
      R(-0.42, -0.05, 0.42, 0.38, 'soft', true),
      E(0, -0.3, 0.09, 0.14, 'solid'),
      L(0, -0.16, 0, 0.12),
    ],
  },
  ct: {
    label: 'Máy CT / MRI',
    width: 2.6,
    depth: 2,
    height: 1.9,
    shapes: [
      R(-0.5, -0.5, 0.5, -0.05, 'base', true),
      E(0, -0.28, 0.2, 0.17),
      R(-0.12, -0.32, 0.12, 0.5, 'soft', true, [0, 0.85]),
    ],
  },
  ivPole: {
    label: 'Cột truyền dịch',
    width: 0.45,
    depth: 0.45,
    height: 0.08,
    solidHeight: 1.9,
    shapes: [
      E(0, 0, 0.5, 0.5, 'base'),
      E(0, 0, 0.1, 0.1, 'solid'),
      L(-0.35, -0.35, 0.35, 0.35),
      L(-0.35, 0.35, 0.35, -0.35),
    ],
  },
  sink: {
    label: 'Bồn rửa tay',
    width: 0.6,
    depth: 0.45,
    height: 0.85,
    solidHeight: 1,
    shapes: [
      R(-0.5, -0.5, 0.5, 0.5, 'base', true),
      E(0, 0.08, 0.36, 0.3),
      E(0, -0.36, 0.05, 0.07, 'solid'),
    ],
  },
  toilet: {
    label: 'Bồn cầu',
    width: 0.4,
    depth: 0.7,
    height: 0.4,
    shapes: [R(-0.5, -0.5, 0.5, -0.2, 'base', true), E(0, 0.15, 0.45, 0.33, 'base')],
  },
};

export const FURNITURE_KINDS = Object.keys(FURNITURE) as FurnitureKind[];

/**
 * Hình vẽ theo mét, tâm ở gốc (chưa xoay). `z` = cao độ đáy / đỉnh khi dựng khối 3D (null = chỉ là
 * nét vẽ trên mặt bằng).
 */
export type Shape =
  | {
      kind: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
      radius: number;
      fill?: ShapeFill;
      z: [number, number] | null;
    }
  | {
      kind: 'ellipse';
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      fill?: ShapeFill;
      z: [number, number] | null;
    }
  | { kind: 'line'; points: number[] };

/** Hình vẽ của ký hiệu `kind` khi có kích thước `width` × `depth` (m). */
export function furnitureShapes(kind: FurnitureKind, width: number, depth: number): Shape[] {
  const def = FURNITURE[kind];
  const zOf = (fill: ShapeFill | undefined, z?: [number, number]): [number, number] | null =>
    z ??
    (fill === 'base'
      ? [0, def.height]
      : fill === 'solid'
        ? [0, def.solidHeight ?? def.height * 1.6]
        : fill === 'soft'
          ? [def.height, def.height + 0.06]
          : null);
  return def.shapes.map((s) => {
    if (s.kind === 'line') {
      return { kind: 'line', points: s.points.map((v, i) => v * (i % 2 ? depth : width)) };
    }
    if (s.kind === 'ellipse') {
      return {
        ...s,
        cx: s.cx * width,
        cy: s.cy * depth,
        rx: s.rx * width,
        ry: s.ry * depth,
        z: zOf(s.fill),
      };
    }
    const w = (s.x1 - s.x0) * width;
    const h = (s.y1 - s.y0) * depth;
    return {
      kind: 'rect',
      x: s.x0 * width,
      y: s.y0 * depth,
      w,
      h,
      radius: s.round ? Math.min(0.08, Math.min(w, h) * 0.25) : 0,
      fill: s.fill,
      z: zOf(s.fill, s.z),
    };
  });
}
