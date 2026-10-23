/** Vẽ ký hiệu nội thất / thiết bị trên mặt bằng 2D (Konva, toạ độ mét). */
import { Ellipse, Group, Line, Rect } from 'react-konva';
import type { Furniture } from '@hwn/map-core';
import { withAlpha, type MapTheme } from '../core/theme';
import { furnitureShapes, type ShapeFill } from '../core/furniture';

const fillOf = (fill: ShapeFill | undefined, ink: string, base: string) =>
  fill === 'base'
    ? base
    : fill === 'solid'
      ? withAlpha(ink, 0.75)
      : fill === 'soft'
        ? withAlpha(ink, 0.18)
        : undefined;

export function FurnitureMark({
  item,
  theme,
  opacity = 1,
  color = theme.roomLabel,
}: {
  item: Pick<Furniture, 'kind' | 'position' | 'width' | 'depth' | 'rotation'>;
  theme: MapTheme;
  opacity?: number;
  color?: string;
}) {
  const stroke = { stroke: color, strokeWidth: 1, strokeScaleEnabled: false };
  return (
    <Group
      x={item.position.x}
      y={item.position.y}
      rotation={item.rotation ?? 0}
      opacity={opacity}
      listening={false}
    >
      {furnitureShapes(item.kind, item.width, item.depth).map((s, i) =>
        s.kind === 'rect' ? (
          <Rect
            key={i}
            x={s.x}
            y={s.y}
            width={s.w}
            height={s.h}
            cornerRadius={s.radius}
            fill={fillOf(s.fill, color, theme.floor)}
            {...stroke}
          />
        ) : s.kind === 'ellipse' ? (
          <Ellipse
            key={i}
            x={s.cx}
            y={s.cy}
            radiusX={s.rx}
            radiusY={s.ry}
            fill={fillOf(s.fill, color, theme.floor)}
            {...stroke}
          />
        ) : (
          <Line key={i} points={s.points} {...stroke} />
        ),
      )}
    </Group>
  );
}

export function FurnitureLayer({
  furniture,
  theme,
}: {
  furniture: readonly Furniture[];
  theme: MapTheme;
}) {
  return (
    <Group listening={false}>
      {furniture.map((f) => (
        <FurnitureMark key={f.id} item={f} theme={theme} />
      ))}
    </Group>
  );
}
