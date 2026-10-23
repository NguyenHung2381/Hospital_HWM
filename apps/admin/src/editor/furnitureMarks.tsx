/** Biểu tượng menu (SVG) của ký hiệu nội thất / thiết bị trong thư viện. */
import type { FurnitureKind } from '@hwn/map-core';
import { FURNITURE, furnitureShapes, type ShapeFill } from '@hwn/map-render';

/** Biểu tượng 20×20 của ký hiệu cho menu thư viện (giữ tỉ lệ ngang / sâu). */
export function FurnitureIcon({ kind }: { kind: FurnitureKind }) {
  const { width, depth } = FURNITURE[kind];
  const k = 18 / Math.max(width, depth);
  const ink = 'currentColor';
  const fill = (f: ShapeFill | undefined) => (f === 'solid' || f === 'soft' ? ink : 'none');
  const opacity = (f: ShapeFill | undefined) => (f === 'soft' ? 0.25 : 1);
  return (
    <svg viewBox="-10 -10 20 20" width="20" height="20" aria-hidden>
      <g fill="none" stroke={ink} strokeWidth="1.2" strokeLinejoin="round">
        {furnitureShapes(kind, width * k, depth * k).map((s, i) =>
          s.kind === 'rect' ? (
            <rect
              key={i}
              x={s.x}
              y={s.y}
              width={s.w}
              height={s.h}
              rx={s.radius}
              fill={fill(s.fill)}
              fillOpacity={opacity(s.fill)}
            />
          ) : s.kind === 'ellipse' ? (
            <ellipse
              key={i}
              cx={s.cx}
              cy={s.cy}
              rx={s.rx}
              ry={s.ry}
              fill={fill(s.fill)}
              fillOpacity={opacity(s.fill)}
            />
          ) : (
            <polyline key={i} points={s.points.join(' ')} />
          ),
        )}
      </g>
    </svg>
  );
}
