/** Các lớp vẽ riêng của editor (Konva, toạ độ mét). Dùng bên trong <MapStage>. */
import { useEffect, useMemo, useState } from 'react';
import { Circle, Group, Image as KonvaImage, Line, Path, Rect, Shape, Text } from 'react-konva';
import {
  distance,
  pointOnWall,
  type DoorStyle,
  type Floor,
  type FloorBackground,
  type LandmarkKind,
  type OpeningType,
  type Point,
} from '@hwn/map-core';
import {
  DoorMark,
  flattenPoints,
  LANDMARK_STYLE,
  segmentQuad,
  usePx,
  useViewRect,
  useViewportScale,
  withAlpha,
  type MapTheme,
} from '@hwn/map-render';
import type { OpeningPlacement } from './ops';
import type { SnapKind } from './snap';
import type { ItemRef } from './types';

export const ACCENT = '#f97316';
const OK = '#16a34a';
const BAD = '#dc2626';
const MEASURE = '#2563eb';

/* ------------------------------------------------------------------ */

/** Bội số của ô lớn dùng khi thu nhỏ quá mức (ô lớn hẹp hơn 8 px). */
const COARSER = [1, 5, 10, 50, 100, 500];

/**
 * Lưới chỉ vẽ phần đang nhìn thấy. Ô lớn cạnh `unit` (m) vẽ đậm, chia thành các ô nhỏ cạnh `minor`
 * (thường là bước bắt dính) khi đủ chỗ. Thu nhỏ quá mức thì ô lớn gộp lại ×5, ×10…
 */
export function Grid({
  unit,
  minor = 0,
  theme,
}: {
  unit: number;
  minor?: number;
  theme: MapTheme;
}) {
  const rect = useViewRect();
  const scale = useViewportScale();
  if (unit <= 0) return null;
  const k = COARSER.find((m) => unit * m * scale >= 8);
  if (k === undefined) return null;
  const major = unit * k;
  // Ô nhỏ chỉ vẽ khi ô lớn không bị gộp, chia hết ô lớn và đủ rộng.
  const parts = minor > 0 ? unit / minor : 0;
  const showMinor =
    k === 1 && parts > 1 && Math.abs(parts - Math.round(parts)) < 1e-6 && minor * scale >= 6;

  return (
    <Shape
      listening={false}
      sceneFunc={(ctx) => {
        const lines = (step: number, skipEvery: number) => {
          ctx.beginPath();
          const onMajor = (v: number) =>
            skipEvery > 0 && Math.abs(Math.round(v / skipEvery) * skipEvery - v) < 1e-6;
          for (let x = Math.floor(rect.minX / step) * step; x <= rect.maxX; x += step) {
            if (onMajor(x)) continue;
            ctx.moveTo(x, rect.minY);
            ctx.lineTo(x, rect.maxY);
          }
          for (let y = Math.floor(rect.minY / step) * step; y <= rect.maxY; y += step) {
            if (onMajor(y)) continue;
            ctx.moveTo(rect.minX, y);
            ctx.lineTo(rect.maxX, y);
          }
          ctx.setAttr('lineWidth', 1 / scale);
          ctx.setAttr('strokeStyle', withAlpha(theme.wall, skipEvery ? 0.08 : 0.22));
          ctx.stroke();
        };
        if (showMinor) lines(minor, major);
        lines(major, 0);
      }}
    />
  );
}

/* ------------------------------------------------------------------ */

function useImage(url: string | undefined) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) return;
    const img = new window.Image();
    img.onload = () => setImage(img);
    img.src = url;
    return () => {
      img.onload = null;
      setImage(null);
    };
  }, [url]);
  return url ? image : null;
}

/** Ảnh mặt bằng làm nền để vẽ đè. */
export function BackgroundImage({ background }: { background: FloorBackground }) {
  const image = useImage(background.url);
  if (!image) return null;
  return (
    <KonvaImage
      image={image}
      x={background.offset.x}
      y={background.offset.y}
      scaleX={background.metersPerPixel}
      scaleY={background.metersPerPixel}
      rotation={background.rotation}
      opacity={background.opacity}
      listening={false}
    />
  );
}

/* ------------------------------------------------------------------ */

export function SelectionOverlay({
  floor,
  selection,
  hover,
}: {
  floor: Floor;
  selection: readonly ItemRef[];
  hover: ItemRef | null;
}) {
  const px = usePx();
  const walls = useMemo(() => new Map(floor.walls.map((w) => [w.id, w])), [floor.walls]);

  const outline = (ref: ItemRef, strong: boolean) => {
    const color = strong ? ACCENT : withAlpha(ACCENT, 0.55);
    const width = strong ? 2 : 1.5;
    const key = `${strong ? 's' : 'h'}:${ref.type}:${ref.id}`;
    if (ref.type === 'wall') {
      const w = walls.get(ref.id);
      if (!w) return null;
      const quad = segmentQuad(w, {
        from: 0,
        to: distance(w.start, w.end),
        start: w.start,
        end: w.end,
      });
      return (
        <Line
          key={key}
          points={flattenPoints(quad)}
          closed
          stroke={color}
          strokeWidth={width}
          strokeScaleEnabled={false}
        />
      );
    }
    if (ref.type === 'opening') {
      const o = floor.openings.find((x) => x.id === ref.id);
      const w = o && walls.get(o.wallId);
      if (!o || !w) return null;
      const a = pointOnWall(w, o.offset - o.width / 2);
      const b = pointOnWall(w, o.offset + o.width / 2);
      return (
        <Line
          key={key}
          points={flattenPoints([a, b])}
          stroke={color}
          strokeWidth={strong ? 8 : 6}
          lineCap="round"
          opacity={0.75}
          strokeScaleEnabled={false}
        />
      );
    }
    if (ref.type === 'landmark') {
      const l = floor.landmarks?.find((x) => x.id === ref.id);
      if (!l) return null;
      return (
        <Circle
          key={key}
          x={l.position.x}
          y={l.position.y}
          radius={px(17)}
          stroke={color}
          strokeWidth={strong ? 3 : 2}
          strokeScaleEnabled={false}
        />
      );
    }
    if (ref.type === 'navNode') {
      const n = floor.navGraph.nodes.find((x) => x.id === ref.id);
      if (!n) return null;
      return (
        <Circle
          key={key}
          x={n.position.x}
          y={n.position.y}
          radius={px(8)}
          stroke={color}
          strokeWidth={2.5}
          strokeScaleEnabled={false}
        />
      );
    }
    if (ref.type === 'navEdge') {
      const e = floor.navGraph.edges.find((x) => x.id === ref.id);
      const a = e && floor.navGraph.nodes.find((n) => n.id === e.from);
      const b = e && floor.navGraph.nodes.find((n) => n.id === e.to);
      if (!a || !b) return null;
      return (
        <Line
          key={key}
          points={flattenPoints([a.position, b.position])}
          stroke={color}
          strokeWidth={strong ? 5 : 4}
          opacity={0.8}
          lineCap="round"
          strokeScaleEnabled={false}
        />
      );
    }
    const shape =
      ref.type === 'room'
        ? floor.rooms.find((x) => x.id === ref.id)
        : floor.connectors.find((x) => x.id === ref.id);
    if (!shape) return null;
    return (
      <Line
        key={key}
        points={flattenPoints(shape.polygon)}
        closed
        stroke={color}
        strokeWidth={ref.type === 'room' ? width + 1 : width}
        dash={ref.type === 'room' ? undefined : [px(6), px(4)]}
        strokeScaleEnabled={false}
      />
    );
  };

  const selectedWalls = selection
    .filter((r) => r.type === 'wall')
    .map((r) => walls.get(r.id))
    .filter((w) => !!w);
  // Tay nắm đỉnh chỉ hiện khi chọn đúng một phòng.
  const singleRoom =
    selection.length === 1 && selection[0]!.type === 'room'
      ? floor.rooms.find((r) => r.id === selection[0]!.id)
      : undefined;

  return (
    <Group listening={false}>
      {hover &&
        !selection.some((r) => r.type === hover.type && r.id === hover.id) &&
        outline(hover, false)}
      {selection.map((r) => outline(r, true))}
      {selectedWalls.flatMap((w) =>
        [w.start, w.end].map((p, i) => (
          <Circle
            key={`${w.id}:${i}`}
            x={p.x}
            y={p.y}
            radius={px(6)}
            fill="#ffffff"
            stroke={ACCENT}
            strokeWidth={2}
            strokeScaleEnabled={false}
          />
        )),
      )}
      {singleRoom?.polygon.map((p, i) => (
        <Rect
          key={`v:${i}`}
          x={p.x - px(5)}
          y={p.y - px(5)}
          width={px(10)}
          height={px(10)}
          fill="#ffffff"
          stroke={ACCENT}
          strokeWidth={2}
          strokeScaleEnabled={false}
        />
      ))}
    </Group>
  );
}

const DESTINATION = '#dc2626';

/**
 * Điểm đích đến của các phòng: chấm nhỏ cho mọi phòng có đặt điểm đích, tay nắm kéo được (kèm
 * nhãn) cho phòng đang chọn.
 */
export function RoomDestinations({
  floor,
  selectedRoomId,
}: {
  floor: Floor;
  selectedRoomId?: string | null;
}) {
  const px = usePx();
  return (
    <Group listening={false}>
      {floor.rooms.map((room) => {
        const d = room.destination;
        if (!d) return null;
        const selected = room.id === selectedRoomId;
        return (
          <Group key={room.id} x={d.x} y={d.y}>
            <Circle
              radius={px(selected ? 8 : 5)}
              fill={DESTINATION}
              stroke="#ffffff"
              strokeWidth={2}
              strokeScaleEnabled={false}
            />
            <Circle radius={px(selected ? 3 : 2)} fill="#ffffff" />
            {selected && (
              <Text
                text="Điểm đích"
                x={-px(50)}
                y={px(11)}
                width={px(100)}
                align="center"
                fontSize={px(11)}
                fontStyle="bold"
                fill={DESTINATION}
                stroke="#ffffff"
                strokeWidth={px(3)}
                fillAfterStrokeEnabled
              />
            )}
          </Group>
        );
      })}
    </Group>
  );
}

/** Bóng mờ của mốc sắp đặt theo con trỏ. */
export function LandmarkGhost({ point, kind }: { point: Point; kind: LandmarkKind }) {
  const px = usePx();
  const style = LANDMARK_STYLE[kind];
  const icon = px(11 * 1.15);
  return (
    <Group x={point.x} y={point.y} opacity={0.75} listening={false}>
      <Circle
        radius={px(11)}
        fill={style.color}
        stroke={ACCENT}
        strokeWidth={2}
        dash={[4, 3]}
        strokeScaleEnabled={false}
      />
      <Path
        data={style.icon}
        x={-icon / 2}
        y={-icon / 2}
        scaleX={icon / 24}
        scaleY={icon / 24}
        stroke="#ffffff"
        strokeWidth={3}
        lineCap="round"
        lineJoin="round"
        strokeScaleEnabled={false}
      />
    </Group>
  );
}

/** Đa giác phòng đang vẽ: các cạnh đã chốt + cạnh tới con trỏ + cạnh khép về đỉnh đầu. */
export function RoomPreview({
  chain,
  cursor,
  theme,
  typed,
}: {
  chain: readonly Point[];
  cursor: Point | null;
  theme: MapTheme;
  /** Chiều dài đang gõ (hiện kèm con trỏ nhập). */
  typed?: string;
}) {
  const px = usePx();
  if (!chain.length) return null;
  const pts = cursor ? [...chain, cursor] : [...chain];
  const last = chain[chain.length - 1]!;
  return (
    <Group listening={false}>
      <Line
        points={flattenPoints(pts)}
        closed={pts.length >= 3}
        fill={withAlpha(ACCENT, 0.12)}
        stroke={ACCENT}
        strokeWidth={2}
        dash={[px(6), px(4)]}
        strokeScaleEnabled={false}
      />
      {cursor && (
        <LengthLabel a={last} b={cursor} theme={theme} text={typed ? `${typed}▏m` : undefined} />
      )}
      {chain.map((p, i) => (
        <Rect
          key={i}
          x={p.x - px(4)}
          y={p.y - px(4)}
          width={px(8)}
          height={px(8)}
          fill={i === 0 ? '#ffffff' : ACCENT}
          stroke={ACCENT}
          strokeWidth={1.5}
          strokeScaleEnabled={false}
        />
      ))}
    </Group>
  );
}

/** Vùng kín sẽ thành phòng khi click (xanh) — hoặc đã là phòng (xám, click để chọn). */
export function AreaGhost({ polygon, existing }: { polygon: Point[]; existing: boolean }) {
  return (
    <Line
      points={flattenPoints(polygon)}
      closed
      fill={existing ? 'rgba(100, 116, 139, 0.12)' : withAlpha(OK, 0.18)}
      stroke={existing ? '#64748b' : OK}
      strokeWidth={2}
      strokeScaleEnabled={false}
      listening={false}
    />
  );
}

export function NavEdgePreview({ from, to }: { from: Point; to: Point }) {
  const px = usePx();
  return (
    <Line
      points={flattenPoints([from, to])}
      stroke={ACCENT}
      strokeWidth={2}
      dash={[px(5), px(4)]}
      strokeScaleEnabled={false}
      listening={false}
    />
  );
}

/* ------------------------------------------------------------------ */

function LengthLabel({
  a,
  b,
  theme,
  color = ACCENT,
  text,
  offset,
}: {
  a: Point;
  b: Point;
  theme: MapTheme;
  color?: string;
  /** Nội dung thay cho chiều dài đoạn a-b. */
  text?: string;
  /** Độ lệch (px) của nhãn so với trung điểm đoạn; mặc định nằm phía trên. */
  offset?: Point;
}) {
  const px = usePx();
  const len = distance(a, b);
  if (len < 0.01 && !text) return null;
  const off = offset ?? { x: 0, y: -16 };
  return (
    <Text
      text={text ?? `${len.toFixed(2)} m`}
      x={(a.x + b.x) / 2 + px(off.x - 60)}
      y={(a.y + b.y) / 2 + px(off.y - 6)}
      width={px(120)}
      align="center"
      fontSize={px(12)}
      fontStyle="bold"
      fill={color}
      stroke={theme.labelHalo}
      strokeWidth={px(3)}
      fillAfterStrokeEnabled
      listening={false}
    />
  );
}

/** Tường đang vẽ: các đoạn đã chốt (đã thành tường thật) không vẽ lại; chỉ vẽ đoạn từ điểm cuối tới con trỏ. */
export function WallPreview({
  chain,
  cursor,
  thickness,
  theme,
  typed,
}: {
  chain: readonly Point[];
  cursor: Point | null;
  thickness: number;
  theme: MapTheme;
  /** Chiều dài đang gõ (hiện kèm con trỏ nhập). */
  typed?: string;
}) {
  const px = usePx();
  const last = chain[chain.length - 1];
  return (
    <Group listening={false}>
      {last && cursor && (
        <>
          <Line
            points={flattenPoints([last, cursor])}
            stroke={withAlpha(ACCENT, 0.45)}
            strokeWidth={thickness}
            lineCap="square"
          />
          <Line
            points={flattenPoints([last, cursor])}
            stroke={ACCENT}
            strokeWidth={1.5}
            dash={[px(6), px(4)]}
            strokeScaleEnabled={false}
          />
          <LengthLabel a={last} b={cursor} theme={theme} text={typed ? `${typed}▏m` : undefined} />
        </>
      )}
      {chain.map((p, i) => (
        <Circle key={i} x={p.x} y={p.y} radius={px(4)} fill={ACCENT} />
      ))}
    </Group>
  );
}

const SNAP_COLORS: Record<SnapKind, string> = {
  endpoint: '#f97316',
  wall: '#0ea5e9',
  angle: '#a855f7',
  grid: '#64748b',
  free: '#64748b',
};

export function SnapMarker({ point, kind }: { point: Point; kind: SnapKind }) {
  const px = usePx();
  const color = SNAP_COLORS[kind];
  const r = px(kind === 'endpoint' ? 7 : 5);
  return (
    <Group x={point.x} y={point.y} listening={false}>
      {kind === 'endpoint' || kind === 'wall' ? (
        <Circle radius={r} stroke={color} strokeWidth={2} strokeScaleEnabled={false} />
      ) : (
        <>
          <Line
            points={[-r, 0, r, 0]}
            stroke={color}
            strokeWidth={1.5}
            strokeScaleEnabled={false}
          />
          <Line
            points={[0, -r, 0, r]}
            stroke={color}
            strokeWidth={1.5}
            strokeScaleEnabled={false}
          />
        </>
      )}
    </Group>
  );
}

export function OpeningGhost({
  floor,
  placement,
  width,
  type,
  doorStyle,
}: {
  floor: Floor;
  placement: OpeningPlacement;
  width: number;
  type: OpeningType;
  /** Kiểu cánh xem trước (chỉ dùng cho cửa đi). */
  doorStyle: DoorStyle;
}) {
  const wall = floor.walls.find((w) => w.id === placement.wallId);
  if (!wall) return null;
  const a = pointOnWall(wall, placement.offset - width / 2);
  const b = pointOnWall(wall, placement.offset + width / 2);
  const color = placement.overlaps ? BAD : OK;
  return (
    <Group listening={false}>
      <Line
        points={flattenPoints([a, b])}
        stroke={color}
        strokeWidth={wall.thickness * 1.6}
        opacity={0.7}
      />
      {type === 'door' && (
        <DoorMark
          opening={{ type, style: doorStyle }}
          start={a}
          end={b}
          wallThickness={wall.thickness}
          stroke={color}
        />
      )}
    </Group>
  );
}

export function RectGhost({
  center,
  width,
  depth,
}: {
  center: Point;
  width: number;
  depth: number;
}) {
  return (
    <Rect
      x={center.x - width / 2}
      y={center.y - depth / 2}
      width={width}
      height={depth}
      fill={withAlpha(ACCENT, 0.15)}
      stroke={ACCENT}
      strokeWidth={1.5}
      strokeScaleEnabled={false}
      listening={false}
    />
  );
}

export function CalibrationOverlay({
  points,
  cursor,
  theme,
}: {
  points: readonly Point[];
  cursor: Point | null;
  theme: MapTheme;
}) {
  const px = usePx();
  const [a, b] = points;
  const end = b ?? cursor;
  return (
    <Group listening={false}>
      {a && end && (
        <>
          <Line
            points={flattenPoints([a, end])}
            stroke={BAD}
            strokeWidth={2}
            strokeScaleEnabled={false}
          />
          <LengthLabel a={a} b={end} theme={theme} />
        </>
      )}
      {points.map((p, i) => (
        <Circle key={i} x={p.x} y={p.y} radius={px(5)} fill={BAD} />
      ))}
    </Group>
  );
}

/** Hình chữ nhật tường đang vẽ (công cụ Tường chữ nhật) kèm kích thước hai cạnh. */
export function RectWallPreview({
  a,
  b,
  thickness,
  theme,
}: {
  a: Point;
  b: Point;
  thickness: number;
  theme: MapTheme;
}) {
  const px = usePx();
  const corners = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
  return (
    <Group listening={false}>
      <Line
        points={flattenPoints(corners)}
        closed
        fill={withAlpha(ACCENT, 0.08)}
        stroke={withAlpha(ACCENT, 0.45)}
        strokeWidth={thickness}
        lineJoin="miter"
      />
      <Line
        points={flattenPoints(corners)}
        closed
        stroke={ACCENT}
        strokeWidth={1.5}
        dash={[px(6), px(4)]}
        strokeScaleEnabled={false}
      />
      <LengthLabel
        a={corners[0]!}
        b={corners[1]!}
        theme={theme}
        offset={{ x: 0, y: b.y < a.y ? 16 : -16 }}
      />
      <LengthLabel
        a={corners[1]!}
        b={corners[2]!}
        theme={theme}
        offset={{ x: b.x < a.x ? -50 : 50, y: 0 }}
      />
      <Circle x={a.x} y={a.y} radius={px(4)} fill={ACCENT} />
    </Group>
  );
}

/** Khung chọn vùng: kéo sang phải = chọn đối tượng nằm gọn (viền liền), sang trái = chạm vào (viền đứt). */
export function MarqueeRect({ a, b }: { a: Point; b: Point }) {
  const px = usePx();
  const crossing = b.x < a.x;
  const color = crossing ? OK : MEASURE;
  return (
    <Rect
      x={Math.min(a.x, b.x)}
      y={Math.min(a.y, b.y)}
      width={Math.abs(b.x - a.x)}
      height={Math.abs(b.y - a.y)}
      fill={withAlpha(color, 0.08)}
      stroke={color}
      strokeWidth={1}
      dash={crossing ? [px(5), px(3)] : undefined}
      strokeScaleEnabled={false}
      listening={false}
    />
  );
}

/** Thước đo: đoạn đo, hai vạch đầu mút và nhãn khoảng cách. */
export function MeasureOverlay({
  points,
  cursor,
  theme,
}: {
  points: readonly Point[];
  cursor: Point | null;
  theme: MapTheme;
}) {
  const px = usePx();
  const [a, b] = points;
  const end = b ?? cursor;
  if (!a) return null;
  const tick = (p: Point, q: Point) => {
    const len = distance(p, q) || 1;
    const n = { x: (-(q.y - p.y) / len) * px(6), y: ((q.x - p.x) / len) * px(6) };
    return flattenPoints([
      { x: p.x - n.x, y: p.y - n.y },
      { x: p.x + n.x, y: p.y + n.y },
    ]);
  };
  return (
    <Group listening={false}>
      {end && (
        <>
          <Line
            points={flattenPoints([a, end])}
            stroke={MEASURE}
            strokeWidth={1.5}
            dash={b ? undefined : [px(6), px(4)]}
            strokeScaleEnabled={false}
          />
          <Line points={tick(a, end)} stroke={MEASURE} strokeWidth={2} strokeScaleEnabled={false} />
          <Line points={tick(end, a)} stroke={MEASURE} strokeWidth={2} strokeScaleEnabled={false} />
          <LengthLabel a={a} b={end} theme={theme} color={MEASURE} />
        </>
      )}
      <Circle x={a.x} y={a.y} radius={px(3)} fill={MEASURE} />
      {b && <Circle x={b.x} y={b.y} radius={px(3)} fill={MEASURE} />}
    </Group>
  );
}
