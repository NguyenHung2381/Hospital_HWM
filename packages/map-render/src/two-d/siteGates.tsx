/**
 * Hình minh hoạ cổng trên mặt bằng (toạ độ mét): hai trụ + cánh cổng theo kiểu
 * (thanh chắn / 2 cánh mở quay / cổng kéo xếp / không cánh), vẽ ở trạng thái đang mở hoặc đang đóng.
 */
import { Group, Line, Rect } from 'react-konva';
import type { SiteGate, SiteGateStyle } from '@hwn/map-core';
import type { GateShape } from './siteGeometry';

export const GATE_LEAF_OPEN = '#94a3b8';
export const GATE_LEAF_CLOSED = '#ef4444';

/** Cung quét 90° của cánh cổng quanh bản lề (toạ độ cục bộ). */
function swingArc(hingeY: number, length: number, inSign: number, steps = 8): number[] {
  const toward = -Math.sign(hingeY) || 1; // cánh khép hướng về tâm cổng
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * (Math.PI / 2);
    out.push(inSign * Math.sin(t) * length, hingeY + toward * Math.cos(t) * length);
  }
  return out;
}

/** Cánh cổng xếp (gấp khúc) từ y = `from` tới `to`, biên độ `amp`. */
function zigzag(from: number, to: number, folds: number, amp: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= folds; i++) {
    out.push(i % 2 ? amp : -amp, from + ((to - from) * i) / folds);
  }
  return out;
}

export function GateGlyph({
  gate,
  style,
  shape,
  open,
  pillarColor,
}: {
  gate: SiteGate;
  style: SiteGateStyle;
  shape: GateShape;
  open: boolean;
  pillarColor: string;
}) {
  const half = shape.half;
  const pillar = gate.kind === 'pedestrian' ? 0.8 : 1.2;
  const e = half - pillar / 2; // mép trong của trụ
  const rad = (shape.angle * Math.PI) / 180;
  // Phía trong khuôn viên theo trục x cục bộ (ngược hướng ra ngoài).
  const outDot = shape.outward
    ? shape.outward.x * Math.cos(rad) + shape.outward.y * Math.sin(rad)
    : 1;
  const inSign = outDot < 0 ? 1 : -1;
  const leaf = open ? GATE_LEAF_OPEN : GATE_LEAF_CLOSED;
  const bar = (points: number[], width = 0.24) => (
    <>
      <Line
        points={points}
        stroke="#1e293b"
        strokeWidth={width + 0.14}
        lineCap="round"
        lineJoin="round"
      />
      <Line points={points} stroke={leaf} strokeWidth={width} lineCap="round" lineJoin="round" />
    </>
  );

  return (
    <Group x={gate.position.x} y={gate.position.y} rotation={shape.angle}>
      {/* Khung cổng chính (xe + người). */}
      {gate.kind === 'both' && (
        <Line
          points={[-inSign * 0.9, -half - 0.4, -inSign * 0.9, half + 0.4]}
          stroke={pillarColor}
          strokeWidth={0.6}
          lineCap="round"
          opacity={0.85}
        />
      )}

      {style === 'barrier' &&
        (open ? (
          // Thanh chắn đã nâng: chỉ còn thấy đoạn gần trụ.
          <>
            <Line
              points={[0, -e, 0, -e + 1.2]}
              stroke="#ffffff"
              strokeWidth={0.4}
              lineCap="round"
            />
            <Line
              points={[0, -e, 0, -e + 1.2]}
              stroke="#dc2626"
              strokeWidth={0.4}
              dash={[0.4, 0.4]}
            />
          </>
        ) : (
          <>
            <Line points={[0, -e, 0, e - 0.2]} stroke="#ffffff" strokeWidth={0.4} lineCap="round" />
            <Line
              points={[0, -e, 0, e - 0.2]}
              stroke="#dc2626"
              strokeWidth={0.4}
              dash={[0.6, 0.6]}
            />
          </>
        ))}

      {style === 'double' && (
        <>
          {[-e, e].map((hy) => (
            <Line
              key={hy}
              points={swingArc(hy, e, inSign)}
              stroke={GATE_LEAF_OPEN}
              strokeWidth={0.07}
              dash={[0.25, 0.2]}
              opacity={0.8}
            />
          ))}
          {open
            ? [-e, e].map((hy) => <Group key={hy}>{bar([0, hy, inSign * e * 0.98, hy])}</Group>)
            : bar([0, -e, 0, e])}
        </>
      )}

      {style === 'sliding' && (
        <>
          {/* Ray trượt + cánh xếp: kéo ra hết khi đóng, gấp gọn sát trụ khi mở. */}
          <Line
            points={[0, -e, 0, e]}
            stroke={GATE_LEAF_OPEN}
            strokeWidth={0.06}
            dash={[0.2, 0.2]}
          />
          {open
            ? bar(zigzag(-e, -e + Math.max(0.6, e * 0.18), 8, 0.28), 0.12)
            : bar(zigzag(-e, e, Math.max(4, Math.round(e * 2.2)), 0.28), 0.12)}
        </>
      )}

      {[-1, 1].map((s) => (
        <Rect
          key={s}
          x={-pillar / 2}
          y={s * half - pillar / 2}
          width={pillar}
          height={pillar}
          cornerRadius={0.15}
          fill={pillarColor}
          stroke="#ffffff"
          strokeWidth={1}
          strokeScaleEnabled={false}
        />
      ))}
    </Group>
  );
}
