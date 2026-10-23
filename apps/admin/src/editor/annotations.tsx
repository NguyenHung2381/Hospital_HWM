/** Vẽ ghi chú bản vẽ: đường ghi kích thước và chú thích chữ (Konva, toạ độ mét). */
import { Group, Line, Text } from 'react-konva';
import {
  add,
  angleOf,
  normalize,
  scale,
  sub,
  toDegrees,
  type Annotation,
  type DimensionAnnotation,
  type TextAnnotation,
} from '@hwn/map-core';
import { flattenPoints, usePx, type MapTheme } from '@hwn/map-render';
import { dimensionLine, textBox, uprightAngle } from './ops';

/**
 * Đường ghi kích thước kiểu kiến trúc: hai đường gióng từ điểm đo, đường kích thước có vạch xiên ở
 * hai đầu, số đo nằm giữa ở phía ngoài.
 */
export function DimensionMark({
  dim,
  theme,
  color = theme.roomLabel,
}: {
  dim: Pick<DimensionAnnotation, 'start' | 'end' | 'offset'>;
  theme: MapTheme;
  color?: string;
}) {
  const px = usePx();
  const { a, b, normal, length } = dimensionLine(dim);
  if (length < 1e-6) return null;
  const side = Math.sign(dim.offset) || 1;
  const out = scale(normal, side);
  // Đường gióng: cách điểm đo một khe nhỏ, vượt quá đường kích thước một chút.
  const gap = scale(out, Math.min(px(3), Math.abs(dim.offset)));
  const over = scale(out, px(5));
  const dir = normalize(sub(b, a));
  const slash = scale(normalize(add(dir, normal)), px(5));
  const tick = (p: typeof a) => flattenPoints([sub(p, slash), add(p, slash)]);
  const mid = scale(add(a, b), 0.5);
  const label = add(mid, scale(out, px(10)));
  const line = { stroke: color, strokeWidth: 1, strokeScaleEnabled: false };
  return (
    <Group listening={false}>
      <Line points={flattenPoints([add(dim.start, gap), add(a, over)])} {...line} />
      <Line points={flattenPoints([add(dim.end, gap), add(b, over)])} {...line} />
      <Line points={flattenPoints([a, b])} {...line} />
      <Line points={tick(a)} {...line} strokeWidth={2} />
      <Line points={tick(b)} {...line} strokeWidth={2} />
      <Text
        text={`${length.toFixed(2)} m`}
        x={label.x}
        y={label.y}
        width={px(120)}
        offsetX={px(60)}
        offsetY={px(6)}
        rotation={uprightAngle(toDegrees(angleOf(dir)))}
        align="center"
        fontSize={px(12)}
        fontStyle="bold"
        fill={color}
        stroke={theme.labelHalo}
        strokeWidth={px(3)}
        fillAfterStrokeEnabled
      />
    </Group>
  );
}

/** Chú thích chữ: cỡ chữ theo mét nên to / nhỏ cùng bản vẽ. */
export function TextMark({
  note,
  theme,
  opacity = 1,
}: {
  note: Pick<TextAnnotation, 'position' | 'text' | 'size' | 'rotation'>;
  theme: MapTheme;
  opacity?: number;
}) {
  const { width, height } = textBox(note);
  return (
    <Text
      text={note.text}
      x={note.position.x}
      y={note.position.y}
      width={width * 1.2}
      height={height}
      offsetX={width * 0.6}
      offsetY={height / 2}
      rotation={note.rotation ?? 0}
      align="center"
      verticalAlign="middle"
      fontSize={note.size}
      lineHeight={1.2}
      fill={theme.roomLabel}
      stroke={theme.labelHalo}
      strokeWidth={note.size * 0.15}
      fillAfterStrokeEnabled
      opacity={opacity}
      listening={false}
    />
  );
}

export function Annotations({
  annotations,
  theme,
}: {
  annotations: readonly Annotation[];
  theme: MapTheme;
}) {
  return (
    <Group listening={false}>
      {annotations.map((a) =>
        a.kind === 'dimension' ? (
          <DimensionMark key={a.id} dim={a} theme={theme} />
        ) : (
          <TextMark key={a.id} note={a} theme={theme} />
        ),
      )}
    </Group>
  );
}
