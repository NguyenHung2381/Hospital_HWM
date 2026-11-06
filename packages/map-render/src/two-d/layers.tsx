/**
 * Các thành phần vẽ 2D (Konva), toạ độ theo mét. Dùng bên trong <MapStage>.
 * Editor của admin (Giai đoạn 2) có thể dùng lại từng thành phần.
 */
import Konva from 'konva';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Circle, Group, Label, Line, Path, Rect, Shape, Tag, Text, Wedge } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import {
  boundsOf,
  polygonCentroid,
  polylineLength,
  roomDestination,
  type BBox,
  type Connector,
  type Department,
  type Floor,
  type Id,
  type Landmark,
  type NavNodeKind,
  type Opening,
  type Point,
  type Room,
  type RouteEntry,
  type WallKind,
} from '@hwn/map-core';
import { CONNECTOR_LABEL, connectorColor } from '../core/connectors';
import { doorSymbol } from '../core/doors';
import { LANDMARK_STYLE } from '../core/landmarks';
import { usePrefersReducedMotion } from '../core/hooks';
import { flattenPoints, pointAlong, slicePolyline, type FloorRouteSegment } from '../core/route';
import { withAlpha, type MapTheme } from '../core/theme';
import { layoutWall, wallKindOf } from '../core/walls';
import { orientPositive, segmentOutline, wallJoints } from '../core/wallJoints';
import type { RouteHighlight, RouteProgress } from '../types';
import { usePx, useViewportRotation, useViewportScale } from './MapStage';

const setCursor = (e: KonvaEventObject<MouseEvent>, cursor: string) => {
  const container = e.target.getStage()?.container();
  if (container) container.style.cursor = cursor;
};

/* ------------------------------------------------------------------ */
/* Nền tầng                                                            */
/* ------------------------------------------------------------------ */

export function FloorSlab({ bounds, theme }: { bounds: BBox | null; theme: MapTheme }) {
  if (!bounds) return null;
  return (
    <Rect
      x={bounds.minX}
      y={bounds.minY}
      width={bounds.maxX - bounds.minX}
      height={bounds.maxY - bounds.minY}
      fill={theme.floor}
      listening={false}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Phòng                                                               */
/* ------------------------------------------------------------------ */

export interface RoomsProps {
  rooms: readonly Room[];
  departments?: readonly Department[];
  theme: MapTheme;
  highlightRoomId?: Id | null;
  selectedRoomId?: Id | null;
  onRoomClick?: (room: Room) => void;
}

export function Rooms({
  rooms,
  departments = [],
  theme,
  highlightRoomId,
  selectedRoomId,
  onRoomClick,
}: RoomsProps) {
  const colors = useMemo(() => new Map(departments.map((d) => [d.id, d.color])), [departments]);
  return (
    <Group listening={!!onRoomClick}>
      {rooms.map((room) => {
        const color = room.departmentId ? colors.get(room.departmentId) : undefined;
        const highlighted = room.id === highlightRoomId;
        const selected = room.id === selectedRoomId;
        return (
          <Line
            key={room.id}
            points={flattenPoints(room.polygon)}
            closed
            fill={
              highlighted
                ? withAlpha(theme.roomHighlight, 0.3)
                : color
                  ? withAlpha(color, 0.18)
                  : theme.roomFill
            }
            stroke={
              highlighted || selected
                ? theme.roomHighlight
                : color
                  ? withAlpha(color, 0.55)
                  : theme.roomStroke
            }
            strokeWidth={highlighted || selected ? 3 : 1}
            strokeScaleEnabled={false}
            onClick={(e) => {
              e.evt.preventDefault();
              onRoomClick?.(room);
            }}
            onTap={(e) => {
              e.evt.preventDefault();
              onRoomClick?.(room);
            }}
            onMouseEnter={(e) => onRoomClick && setCursor(e, 'pointer')}
            onMouseLeave={(e) => setCursor(e, '')}
          />
        );
      })}
    </Group>
  );
}

/* ------------------------------------------------------------------ */
/* Tường & cửa                                                         */
/* ------------------------------------------------------------------ */

/** Ký hiệu cánh cửa (theo kiểu cánh) của ô cửa từ `start` tới `end`. */
export function DoorMark({
  opening,
  start,
  end,
  wallThickness,
  stroke,
  opacity,
}: {
  opening: Pick<Opening, 'type' | 'style' | 'hingeAtEnd' | 'opensOtherSide'>;
  start: Point;
  end: Point;
  wallThickness: number;
  stroke: string;
  opacity?: number;
}) {
  const { leaves, panels } = doorSymbol(opening, start, end, wallThickness);
  return (
    <Group listening={false} opacity={opacity}>
      {leaves.map((leaf, i) => (
        <Line
          key={`l${i}`}
          points={flattenPoints([leaf.hinge, ...leaf.arc])}
          stroke={stroke}
          strokeWidth={1}
          strokeScaleEnabled={false}
        />
      ))}
      {panels.map((panel, i) => (
        <Line
          key={`p${i}`}
          points={flattenPoints([panel.a, panel.b])}
          stroke={stroke}
          strokeWidth={3}
          lineCap="butt"
          strokeScaleEnabled={false}
        />
      ))}
    </Group>
  );
}

/** Thân tường đặc, vẽ theo loại tường. */
export function WallBody({
  kind,
  corners,
  theme,
  opacity,
}: {
  kind: WallKind;
  corners: Point[];
  theme: MapTheme;
  opacity?: number;
}) {
  const points = flattenPoints(corners);
  switch (kind) {
    case 'brick':
      return <Line points={points} closed fill={theme.wall} opacity={opacity} />;
    case 'concrete':
      return (
        <Shape
          opacity={opacity}
          sceneFunc={(ctx) => hatchQuad(ctx._context, corners, theme.wall, theme.floor)}
        />
      );
    case 'partition':
      return <Line points={points} closed fill={withAlpha(theme.wall, 0.55)} opacity={opacity} />;
    case 'glass':
      return (
        <Line
          points={points}
          closed
          fill={withAlpha(theme.window, 0.35)}
          stroke={theme.window}
          strokeWidth={1.5}
          strokeScaleEnabled={false}
          opacity={opacity}
        />
      );
    case 'railing':
      return (
        <Line
          points={points}
          closed
          fill={withAlpha(theme.wall, 0.12)}
          stroke={theme.wall}
          strokeWidth={1}
          dash={[0.2, 0.12]}
          strokeScaleEnabled={false}
          opacity={opacity}
        />
      );
  }
}

/** Tô đa giác `corners` rồi gạch chéo bên trong (ký hiệu bê tông). Toạ độ theo mét. */
function hatchQuad(
  c: CanvasRenderingContext2D,
  corners: readonly Point[],
  fill: string,
  hatch: string,
  spacing = 0.12,
) {
  const b = boundsOf(corners);
  if (!b) return;
  c.save();
  c.beginPath();
  corners.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  c.clip();
  const h = b.maxY - b.minY;
  c.beginPath();
  for (let x = b.minX - h; x < b.maxX; x += spacing) {
    c.moveTo(x, b.maxY);
    c.lineTo(x + h, b.minY);
  }
  c.strokeStyle = withAlpha(hatch, 0.6);
  c.lineWidth = spacing * 0.3;
  c.stroke();
  c.restore();
}

/** Vẽ các đa giác vào cùng một path (đã cùng chiều) — tô một lần nên chỗ hai đa giác giáp nhau không lộ khe. */
function tracePolygons(c: CanvasRenderingContext2D, polygons: readonly (readonly Point[])[]) {
  c.beginPath();
  for (const poly of polygons) {
    poly.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.closePath();
  }
}

/**
 * Thân tường đặc cùng một loại, tô chung một lần: các đoạn tường nối vát khít nhau thành một khối
 * liền (không có đường khe mờ ở mối nối, vách bán trong suốt không đậm màu ở góc).
 */
function WallMass({
  kind,
  polygons,
  theme,
}: {
  kind: WallKind;
  polygons: readonly (readonly Point[])[];
  theme: MapTheme;
}) {
  const box = useMemo(() => boundsOf(polygons.flat()), [polygons]);
  if (!box || polygons.length === 0) return null;
  return (
    <Shape
      listening={false}
      sceneFunc={(ctx, shape) => {
        const c = ctx._context;
        const px = 1 / Math.max(Math.abs(shape.getAbsoluteScale().x), 1e-6);
        c.save();
        tracePolygons(c, polygons);
        switch (kind) {
          case 'brick':
            c.fillStyle = theme.wall;
            c.fill();
            break;
          case 'partition':
            c.fillStyle = withAlpha(theme.wall, 0.55);
            c.fill();
            break;
          case 'concrete': {
            c.fillStyle = theme.wall;
            c.fill();
            c.clip();
            const h = box.maxY - box.minY;
            const spacing = 0.12;
            c.beginPath();
            for (let x = box.minX - h; x < box.maxX; x += spacing) {
              c.moveTo(x, box.maxY);
              c.lineTo(x + h, box.minY);
            }
            c.strokeStyle = withAlpha(theme.floor, 0.6);
            c.lineWidth = spacing * 0.3;
            c.stroke();
            break;
          }
          case 'glass':
            c.fillStyle = withAlpha(theme.window, 0.35);
            c.fill();
            c.strokeStyle = theme.window;
            c.lineWidth = 1.5 * px;
            c.lineJoin = 'miter';
            c.stroke();
            break;
          case 'railing':
            c.fillStyle = withAlpha(theme.wall, 0.12);
            c.fill();
            c.strokeStyle = theme.wall;
            c.lineWidth = px;
            c.setLineDash([0.2, 0.12]);
            c.stroke();
            break;
        }
        c.restore();
      }}
    />
  );
}

const WALL_KIND_ORDER: readonly WallKind[] = ['railing', 'glass', 'partition', 'brick', 'concrete'];

export function Walls({ floor, theme }: { floor: Floor; theme: MapTheme }) {
  const { masses, shapes } = useMemo(() => {
    const openings = new Map(floor.openings.map((o) => [o.id, o]));
    // Gom ô cửa theo tường để layoutWall không lọc cả danh sách cho từng tường (tầng nghìn tường).
    const openingsOf = new Map<Id, Opening[]>();
    for (const o of floor.openings) {
      const list = openingsOf.get(o.wallId);
      if (list) list.push(o);
      else openingsOf.set(o.wallId, [o]);
    }
    const joints = wallJoints(floor.walls);
    const masses = new Map<WallKind, Point[][]>();
    const shapes = floor.walls.flatMap((wall) =>
      layoutWall(wall, openingsOf.get(wall.id) ?? []).flatMap((segment, i) => {
        const corners = segmentOutline(wall, segment, joints.get(wall.id));
        if (segment.kind === 'solid') {
          const kind = wallKindOf(wall);
          const list = masses.get(kind);
          if (list) list.push(orientPositive(corners));
          else masses.set(kind, [orientPositive(corners)]);
          return [];
        }
        return [
          {
            key: `${wall.id}:${i}`,
            segment,
            thickness: wall.thickness,
            opening: segment.openingId ? openings.get(segment.openingId) : undefined,
            corners,
          },
        ];
      }),
    );
    return { masses, shapes };
  }, [floor.walls, floor.openings]);

  return (
    <Group listening={false}>
      {WALL_KIND_ORDER.map((kind) => {
        const polygons = masses.get(kind);
        return polygons ? (
          <WallMass key={kind} kind={kind} polygons={polygons} theme={theme} />
        ) : null;
      })}
      {shapes.map(({ key, segment, thickness, opening, corners }) => {
        switch (segment.kind) {
          case 'window':
            return (
              <Group key={key}>
                <Line
                  points={flattenPoints(corners)}
                  closed
                  fill={theme.floor}
                  stroke={theme.wall}
                  strokeWidth={1}
                  strokeScaleEnabled={false}
                />
                <Line
                  points={flattenPoints([segment.start, segment.end])}
                  stroke={theme.window}
                  strokeWidth={2}
                  strokeScaleEnabled={false}
                />
              </Group>
            );
          case 'door':
            return opening ? (
              <DoorMark
                key={key}
                opening={opening}
                start={segment.start}
                end={segment.end}
                wallThickness={thickness}
                stroke={theme.door}
              />
            ) : null;
          case 'entrance':
            return (
              <Line
                key={key}
                points={flattenPoints([segment.start, segment.end])}
                stroke={theme.entrance}
                strokeWidth={5}
                lineCap="round"
                strokeScaleEnabled={false}
              />
            );
          default:
            return null;
        }
      })}
    </Group>
  );
}

/* ------------------------------------------------------------------ */
/* Thang                                                               */
/* ------------------------------------------------------------------ */

/** Ký hiệu kiến trúc: thang máy = dấu X, thang bộ/cuốn = các bậc song song. */
function connectorSymbol(connector: Connector): number[][] {
  const box = boundsOf(connector.polygon);
  if (!box) return [];
  const { minX, minY, maxX, maxY } = box;
  if (connector.type === 'elevator') {
    return [
      [minX, minY, maxX, maxY],
      [minX, maxY, maxX, minY],
    ];
  }
  // Dốc có thể cong (đa giác bất kỳ): không vẽ vạch bậc, chỉ tô nền + nhãn.
  if (connector.type === 'ramp') return [];
  const step = connector.type === 'stairs' ? 0.35 : 0.25;
  const horizontal = maxX - minX >= maxY - minY; // bậc chạy dọc theo cạnh dài
  const lines: number[][] = [];
  if (horizontal) {
    for (let x = minX + step; x < maxX - 1e-6; x += step) lines.push([x, minY, x, maxY]);
  } else {
    for (let y = minY + step; y < maxY - 1e-6; y += step) lines.push([minX, y, maxX, y]);
  }
  return lines;
}

export function Connectors({
  connectors,
  theme,
  selectedId,
}: {
  connectors: readonly Connector[];
  theme: MapTheme;
  selectedId?: Id | null;
}) {
  return (
    <Group listening={false}>
      {connectors.map((c) => {
        const color = connectorColor(c, theme.connectorStroke);
        const custom = color !== theme.connectorStroke;
        return (
          <Group key={c.id}>
            <Line
              points={flattenPoints(c.polygon)}
              closed
              fill={custom ? withAlpha(color, 0.16) : theme.connectorFill}
              stroke={c.id === selectedId ? theme.roomHighlight : color}
              strokeWidth={c.id === selectedId ? 3 : 1.5}
              strokeScaleEnabled={false}
            />
            {connectorSymbol(c).map((pts, i) => (
              <Line
                key={i}
                points={pts}
                stroke={withAlpha(color, 0.6)}
                strokeWidth={1}
                strokeScaleEnabled={false}
              />
            ))}
          </Group>
        );
      })}
    </Group>
  );
}

/* ------------------------------------------------------------------ */
/* Nhãn                                                                */
/* ------------------------------------------------------------------ */

/** Ẩn nhãn nếu vùng chứa nhỏ hơn số pixel này. */
const MIN_LABEL_BOX_PX = 44;

export function Labels({
  floor,
  theme,
  fontPx = 12,
}: {
  floor: Floor;
  theme: MapTheme;
  fontPx?: number;
}) {
  const scaleNow = useViewportScale();
  const rotation = useViewportRotation();
  // Bản đồ xoay gần 90°: nhãn đứng thẳng trên màn hình nên đổi chiều rộng/cao của ô chứa.
  const sideways = Math.abs((((rotation % 180) + 180) % 180) - 90) < 45;
  const px = usePx();
  const items = useMemo(
    () =>
      [
        ...floor.rooms.map((r) => ({ ...r, text: `${r.name}\n${r.code}` })),
        ...floor.connectors.map((c) => ({ ...c, text: c.name })),
      ].flatMap((shape) => {
        const box = boundsOf(shape.polygon);
        return box
          ? [{ id: shape.id, text: shape.text, box, center: polygonCentroid(shape.polygon) }]
          : [];
      }),
    [floor.rooms, floor.connectors],
  );

  return (
    <Group listening={false}>
      {items.map(({ id, text, box, center }) => {
        const bw = box.maxX - box.minX;
        const bh = box.maxY - box.minY;
        const w = (sideways ? bh : bw) * 0.92;
        const h = sideways ? bw : bh;
        if (w * scaleNow < MIN_LABEL_BOX_PX || h * scaleNow < fontPx * 1.5) return null;
        return (
          <Text
            key={id}
            text={text}
            x={center.x}
            y={center.y}
            offsetX={w / 2}
            offsetY={h / 2}
            rotation={-rotation}
            width={w}
            height={h}
            align="center"
            verticalAlign="middle"
            wrap="word"
            ellipsis
            fontSize={px(fontPx)}
            lineHeight={1.2}
            fill={theme.roomLabel}
            stroke={theme.labelHalo}
            strokeWidth={px(3)}
            fillAfterStrokeEnabled
          />
        );
      })}
    </Group>
  );
}

/* ------------------------------------------------------------------ */
/* Đồ thị đi lại (debug / admin)                                        */
/* ------------------------------------------------------------------ */

const NODE_COLORS: Record<NavNodeKind, string> = {
  corridor: '#a855f7',
  door: '#64748b',
  room: '#0ea5e9',
  connector: '#7c3aed',
  entrance: '#16a34a',
};

export function NavGraph({ floor, theme }: { floor: Floor; theme: MapTheme }) {
  const px = usePx();
  const nodes = useMemo(
    () => new Map(floor.navGraph.nodes.map((n) => [n.id, n])),
    [floor.navGraph.nodes],
  );
  return (
    <Group listening={false}>
      {floor.navGraph.edges.map((e) => {
        const a = nodes.get(e.from);
        const b = nodes.get(e.to);
        if (!a || !b) return null;
        return (
          <Line
            key={e.id}
            points={flattenPoints([a.position, b.position])}
            stroke={theme.navEdge}
            strokeWidth={1.5}
            dash={[px(5), px(4)]}
            strokeScaleEnabled={false}
          />
        );
      })}
      {floor.navGraph.nodes.map((n) => (
        <Circle
          key={n.id}
          x={n.position.x}
          y={n.position.y}
          radius={px(4)}
          fill={NODE_COLORS[n.kind]}
          stroke={theme.floor}
          strokeWidth={1}
          strokeScaleEnabled={false}
        />
      ))}
    </Group>
  );
}

/* ------------------------------------------------------------------ */
/* Mốc                                                                 */
/* ------------------------------------------------------------------ */

/** Hiện tên mốc khi zoom đủ lớn (pixel / mét). */
const LANDMARK_LABEL_MIN_SCALE = 16;

/** Mốc độc lập: biểu tượng tròn theo loại, tên hiện khi zoom gần. Luôn đứng thẳng khi bản đồ xoay. */
export function Landmarks({
  landmarks,
  theme,
  highlightId,
  selectedId,
  showLabels = true,
  onLandmarkClick,
}: {
  landmarks: readonly Landmark[];
  theme: MapTheme;
  /** Mốc là điểm đến — vẽ to và luôn hiện tên. */
  highlightId?: Id | null;
  /** Mốc đang được chọn (editor). */
  selectedId?: Id | null;
  showLabels?: boolean;
  /** Chạm/click vào biểu tượng mốc. */
  onLandmarkClick?: (landmark: Landmark) => void;
}) {
  const px = usePx();
  const scaleNow = useViewportScale();
  const rotation = useViewportRotation();
  return (
    <Group listening={!!onLandmarkClick}>
      {landmarks.map((l) => {
        const style = LANDMARK_STYLE[l.kind] ?? LANDMARK_STYLE.other;
        const big = l.id === highlightId;
        const r = big ? 14 : 11;
        const iconSize = r * 1.15;
        const pick = (e: KonvaEventObject<Event>) => {
          e.evt.preventDefault();
          onLandmarkClick?.(l);
        };
        return (
          <Group
            key={l.id}
            x={l.position.x}
            y={l.position.y}
            rotation={-rotation}
            onClick={pick}
            onTap={pick}
            onMouseEnter={(e) => onLandmarkClick && setCursor(e, 'pointer')}
            onMouseLeave={(e) => setCursor(e, '')}
          >
            {l.id === selectedId && (
              <Circle
                radius={px(r + 5)}
                stroke={theme.roomHighlight}
                strokeWidth={2.5}
                strokeScaleEnabled={false}
              />
            )}
            <Circle
              radius={px(r)}
              fill={style.color}
              stroke={theme.labelHalo}
              strokeWidth={2}
              strokeScaleEnabled={false}
              shadowColor="#000000"
              shadowOpacity={0.25}
              shadowBlur={px(4)}
            />
            <Path
              data={style.icon}
              x={-px(iconSize / 2)}
              y={-px(iconSize / 2)}
              scaleX={px(iconSize) / 24}
              scaleY={px(iconSize) / 24}
              stroke="#ffffff"
              strokeWidth={3}
              lineCap="round"
              lineJoin="round"
            />
            {showLabels && (big || scaleNow >= LANDMARK_LABEL_MIN_SCALE) && (
              <Text
                text={l.name}
                x={-px(80)}
                y={px(r + 3)}
                width={px(160)}
                align="center"
                fontSize={px(big ? 12 : 11)}
                fontStyle={big ? 'bold' : 'normal'}
                fill={big ? style.color : theme.roomLabel}
                stroke={theme.labelHalo}
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

/* ------------------------------------------------------------------ */
/* Ghim điểm đích của phòng                                            */
/* ------------------------------------------------------------------ */

/** Ghim nhỏ chỉ hiện khi zoom đủ gần (pixel / mét) để bản đồ không rối. */
const PIN_MIN_SCALE = 9;
/** Hình giọt nước, mũi nhọn ở (0, 0), khung 24×24 dịch lên trên. */
const PIN_PATH = 'M0 0C-2-5-8-9-8-15a8 8 0 0 1 16 0c0 6-6 10-8 15z';

/**
 * Ghim tại điểm đích đến của mỗi phòng (chỉ các phòng có `destination` hợp lệ). Màu theo khoa;
 * phòng `highlightRoomId` có ghim to, nổi bật kèm tên.
 */
export function RoomPins({
  rooms,
  departments = [],
  theme,
  highlightRoomId,
  hiddenRoomId,
  onRoomClick,
}: {
  rooms: readonly Room[];
  departments?: readonly Department[];
  theme: MapTheme;
  highlightRoomId?: Id | null;
  /** Không vẽ ghim của phòng này (vd. tuyến đường đã có dấu điểm đến ở đó). */
  hiddenRoomId?: Id | null;
  onRoomClick?: (room: Room) => void;
}) {
  const px = usePx();
  const scaleNow = useViewportScale();
  const rotation = useViewportRotation();
  const colors = useMemo(() => new Map(departments.map((d) => [d.id, d.color])), [departments]);
  return (
    <Group listening={!!onRoomClick}>
      {rooms.map((room) => {
        const at = roomDestination(room);
        if (!at || room.id === hiddenRoomId) return null;
        const big = room.id === highlightRoomId;
        if (!big && scaleNow < PIN_MIN_SCALE) return null;
        const color = big
          ? theme.destination
          : ((room.departmentId && colors.get(room.departmentId)) ?? theme.connectorStroke);
        const k = px(big ? 1.6 : 1.05);
        const pick = (e: KonvaEventObject<Event>) => {
          e.evt.preventDefault();
          onRoomClick?.(room);
        };
        return (
          <Group
            key={room.id}
            x={at.x}
            y={at.y}
            rotation={-rotation}
            onClick={pick}
            onTap={pick}
            onMouseEnter={(e) => onRoomClick && setCursor(e, 'pointer')}
            onMouseLeave={(e) => setCursor(e, '')}
          >
            <Path
              data={PIN_PATH}
              scaleX={k}
              scaleY={k}
              fill={color}
              stroke={theme.labelHalo}
              strokeWidth={2}
              strokeScaleEnabled={false}
              shadowColor="#000000"
              shadowOpacity={0.3}
              shadowBlur={px(4)}
              shadowOffsetY={px(1)}
            />
            <Circle y={-15 * k} radius={3.2 * k} fill={theme.labelHalo} />
            {big && (
              <Text
                text={room.code ? `${room.name} · ${room.code}` : room.name}
                x={-px(100)}
                y={-px(48)}
                width={px(200)}
                align="center"
                fontSize={px(12)}
                fontStyle="bold"
                fill={color}
                stroke={theme.labelHalo}
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

/** Biểu tượng cửa (khung 24×24): khung cửa + cánh mở + mũi tên đi vào. */
const DOOR_ICON = 'M5 21V4h9v17M14 4l5 2v15M3 21h18M8 12h3m-1.5-1.5L11 12l-1.5 1.5';

/** Dấu cửa đi vào phòng đích trên tuyến đường. */
export function EntryMarker({ at, label, theme }: { at: Point; label?: string; theme: MapTheme }) {
  const px = usePx();
  const scaleNow = useViewportScale();
  const rotation = useViewportRotation();
  const size = 20;
  return (
    <Group x={at.x} y={at.y} rotation={-rotation} listening={false}>
      <Rect
        x={-px(size / 2)}
        y={-px(size / 2)}
        width={px(size)}
        height={px(size)}
        cornerRadius={px(5)}
        fill={theme.route}
        stroke={theme.routeCasing}
        strokeWidth={2}
        strokeScaleEnabled={false}
      />
      <Path
        data={DOOR_ICON}
        x={-px(7)}
        y={-px(7)}
        scaleX={px(14) / 24}
        scaleY={px(14) / 24}
        stroke={theme.routeCasing}
        strokeWidth={2.6}
        lineCap="round"
        lineJoin="round"
      />
      {label && scaleNow >= 14 && (
        <Text
          text={label}
          x={-px(70)}
          y={px(size / 2 + 3)}
          width={px(140)}
          align="center"
          fontSize={px(11)}
          fontStyle="bold"
          fill={theme.route}
          stroke={theme.labelHalo}
          strokeWidth={px(3)}
          fillAfterStrokeEnabled
        />
      )}
    </Group>
  );
}

/* ------------------------------------------------------------------ */
/* Tuyến đường                                                          */
/* ------------------------------------------------------------------ */

/** Điểm trên tuyến, có nhãn dạng "viên thuốc" để không lẫn với nhãn phòng bên dưới. */
function Marker({
  at,
  color,
  theme,
  label,
  radiusPx = 8,
}: {
  at: Point;
  color: string;
  theme: MapTheme;
  label?: string;
  radiusPx?: number;
}) {
  const px = usePx();
  const rotation = useViewportRotation();
  return (
    <Group x={at.x} y={at.y} rotation={-rotation} listening={false}>
      <Circle radius={px(radiusPx)} fill={color} stroke={theme.routeCasing} strokeWidth={px(2.5)} />
      <Circle radius={px(radiusPx * 0.35)} fill={theme.routeCasing} />
      {label && (
        <Label y={-px(radiusPx + 4)}>
          <Tag
            fill={color}
            stroke={theme.routeCasing}
            strokeWidth={px(1.5)}
            cornerRadius={px(8)}
            pointerDirection="down"
            pointerWidth={px(10)}
            pointerHeight={px(6)}
            shadowColor="#000000"
            shadowOpacity={0.25}
            shadowBlur={px(6)}
            shadowOffsetY={px(2)}
          />
          <Text
            text={label}
            padding={px(5)}
            fontSize={px(12)}
            fontStyle="bold"
            fill={theme.routeCasing}
          />
        </Label>
      )}
    </Group>
  );
}

/** Khoảng cách giữa các mũi tên chỉ hướng (px) và tốc độ chúng chạy dọc tuyến (px/giây). */
const ARROW_SPACING_PX = 30;
const ARROW_SPEED_PX = 28;
/** Tốc độ (m/s) và thời lượng tối đa (giây) của chấm đi mô phỏng trên bước đang xem. */
const WALKER_SPEED = 3;
const WALKER_MAX_SECONDS = 6;
const WALKER_PAUSE_SECONDS = 0.7;
const PULSE_SECONDS = 1.6;

/** Chuỗi mũi tên ">" dọc theo `path`, thuộc tính `phase` (px) dịch chúng theo hướng đi. */
function FlowArrows({
  path,
  color,
  shapeRef,
}: {
  path: readonly Point[];
  color: string;
  shapeRef?: (node: Konva.Shape | null) => void;
}) {
  const length = useMemo(() => polylineLength(path), [path]);
  if (path.length < 2 || length < 0.01) return null;
  return (
    <Shape
      ref={shapeRef}
      stroke={color}
      strokeWidth={2.5}
      strokeScaleEnabled={false}
      lineCap="round"
      lineJoin="round"
      listening={false}
      sceneFunc={(ctx, shape) => {
        const k = shape.getAbsoluteScale().x || 1;
        const spacing = ARROW_SPACING_PX / k;
        const size = 3.5 / k;
        const phase = ((Number(shape.getAttr('phase')) || 0) % ARROW_SPACING_PX) / k;
        ctx.beginPath();
        for (let d = phase + spacing / 2; d < length - size; d += spacing) {
          const { point, heading } = pointAlong(path, d);
          const rad = (heading * Math.PI) / 180;
          const dx = Math.cos(rad) * size;
          const dy = Math.sin(rad) * size;
          ctx.moveTo(point.x - dx - dy, point.y - dy + dx);
          ctx.lineTo(point.x + dx * 0.6, point.y + dy * 0.6);
          ctx.lineTo(point.x - dx + dy, point.y - dy - dx);
        }
        ctx.strokeShape(shape);
      }}
    />
  );
}

export interface RouteLayerProps {
  segments: readonly FloorRouteSegment[];
  theme: MapTheme;
  /** Tên tầng để ghi trên điểm chuyển tầng. */
  floorName?: (floorId: Id) => string;
  destinationLabel?: string;
  /** Hiệu ứng chuyển động: mũi tên chạy dọc tuyến, chấm đi mô phỏng, vòng toả sóng. Mặc định bật (tắt khi hệ điều hành yêu cầu giảm chuyển động). */
  animated?: boolean;
  /** Vị trí đã đi tới — phần tuyến phía sau được vẽ mờ. */
  progress?: RouteProgress | null;
  /** Bước đang xem — được tô đậm, đánh dấu điểm thao tác và có chấm đi mô phỏng. */
  activeStep?: RouteHighlight | null;
  /** Hiện chấm đi mô phỏng dọc bước đang xem. Mặc định bật. */
  showWalker?: boolean;
  /** Cửa vào phòng đích (chỉ vẽ khi nằm trên tầng đang xem). */
  entry?: RouteEntry | null;
}

/** Tách đoạn tuyến thành phần đã đi và phần còn lại theo `progress`. */
function splitByProgress(s: FloorRouteSegment, progress?: RouteProgress | null) {
  if (!progress || progress.segmentIndex < s.index) return { done: [], rest: s.path };
  if (progress.segmentIndex > s.index) return { done: s.path, rest: [] };
  const at = progress.distance - s.start;
  const total = s.end - s.start;
  return { done: slicePolyline(s.path, 0, at), rest: slicePolyline(s.path, at, total) };
}

export function RouteLayer({
  segments,
  theme,
  floorName = (id) => id,
  destinationLabel,
  animated: animatedProp,
  progress,
  activeStep,
  showWalker = true,
  entry,
}: RouteLayerProps) {
  const px = usePx();
  const reducedMotion = usePrefersReducedMotion();
  const animated = animatedProp ?? !reducedMotion;
  const arrowRefs = useRef(new Set<Konva.Shape>());
  const walkerRef = useRef<Konva.Group>(null);
  const pulseRef = useRef<Konva.Circle>(null);

  const parts = useMemo(
    () => segments.map((s) => ({ s, ...splitByProgress(s, progress) })),
    [segments, progress],
  );
  const active =
    activeStep && segments.some((s) => s.index === activeStep.segmentIndex) ? activeStep : null;
  const activePath = active?.path;
  const activeLength = useMemo(() => (activePath ? polylineLength(activePath) : 0), [activePath]);

  useEffect(() => {
    if (!animated) return;
    const layer =
      walkerRef.current?.getLayer() ??
      pulseRef.current?.getLayer() ??
      [...arrowRefs.current][0]?.getLayer();
    if (!layer) return;
    const walkSeconds = Math.min(WALKER_MAX_SECONDS, Math.max(1.2, activeLength / WALKER_SPEED));
    const anim = new Konva.Animation((frame) => {
      const t = (frame?.time ?? 0) / 1000;
      for (const arrow of arrowRefs.current) arrow.setAttr('phase', t * ARROW_SPEED_PX);

      const pulse = pulseRef.current;
      if (pulse) {
        const k = pulse.getAbsoluteScale().x || 1;
        const p = (t % PULSE_SECONDS) / PULSE_SECONDS;
        pulse.radius((10 + 22 * p) / k);
        pulse.opacity(0.7 * (1 - p));
      }

      const walker = walkerRef.current;
      if (walker && activePath && activePath.length > 1) {
        const cycle = walkSeconds + WALKER_PAUSE_SECONDS;
        const p = Math.min(1, (t % cycle) / walkSeconds);
        const eased = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
        const { point, heading } = pointAlong(activePath, eased * activeLength);
        walker.position(point);
        walker.rotation(heading);
        // Mờ dần ở cuối mỗi vòng để người xem thấy rõ điểm bắt đầu lại.
        walker.opacity(
          p >= 1
            ? Math.max(0, 1 - ((t % cycle) - walkSeconds) / WALKER_PAUSE_SECONDS)
            : Math.min(1, p * 8),
        );
      }
    }, layer);
    anim.start();
    return () => {
      anim.stop();
    };
  }, [animated, activePath, activeLength, parts]);

  const registerArrow = useCallback((node: Konva.Shape | null) => {
    if (!node) return;
    const arrows = arrowRefs.current;
    arrows.add(node);
    return () => {
      arrows.delete(node);
    };
  }, []);

  const lineProps = {
    lineCap: 'round',
    lineJoin: 'round',
    strokeScaleEnabled: false,
  } as const;

  return (
    <Group listening={false}>
      {parts.map(({ s, done, rest }) => (
        <Group key={`${s.floorId}:${s.index}`}>
          <Line
            points={flattenPoints(s.path)}
            stroke={theme.routeCasing}
            strokeWidth={11}
            {...lineProps}
          />
          {done.length > 1 && (
            <Line
              points={flattenPoints(done)}
              stroke={withAlpha(theme.route, 0.35)}
              strokeWidth={6}
              dash={[1, 9]}
              {...lineProps}
            />
          )}
          {rest.length > 1 && (
            <>
              <Line
                points={flattenPoints(rest)}
                stroke={theme.route}
                strokeWidth={7}
                {...lineProps}
              />
              <FlowArrows path={rest} color={theme.routeCasing} shapeRef={registerArrow} />
            </>
          )}
        </Group>
      ))}

      {active && active.path.length > 1 && (
        <Group>
          <Line
            points={flattenPoints(active.path)}
            stroke={withAlpha(theme.route, 0.28)}
            strokeWidth={26}
            {...lineProps}
          />
          <Line
            points={flattenPoints(active.path)}
            stroke={theme.routeCasing}
            strokeWidth={13}
            {...lineProps}
          />
          <Line
            points={flattenPoints(active.path)}
            stroke={theme.route}
            strokeWidth={9}
            {...lineProps}
          />
          <FlowArrows path={active.path} color={theme.routeCasing} shapeRef={registerArrow} />
        </Group>
      )}

      {parts.map(({ s }) => {
        const first = s.path[0];
        const last = s.path[s.path.length - 1];
        return (
          <Group key={`markers:${s.index}`}>
            {first && !s.isFirst && s.arrivedFromFloorId && (
              <Marker
                at={first}
                color={theme.route}
                theme={theme}
                radiusPx={6}
                label={`Từ ${floorName(s.arrivedFromFloorId)}`}
              />
            )}
            {last && s.transition && (
              <Marker
                at={last}
                color={theme.route}
                theme={theme}
                radiusPx={7}
                label={`${CONNECTOR_LABEL[s.transition.connectorType]} → ${floorName(s.transition.toFloorId)}`}
              />
            )}
            {last && s.isLast && (
              <Marker at={last} color={theme.destination} theme={theme} label={destinationLabel} />
            )}
          </Group>
        );
      })}

      {entry && segments.some((s) => s.floorId === entry.floorId) && (
        <EntryMarker at={entry.position} label={entry.label} theme={theme} />
      )}

      {active?.anchor && (
        <Group x={active.anchor.x} y={active.anchor.y}>
          <Circle
            ref={pulseRef}
            radius={px(animated ? 10 : 18)}
            stroke={theme.route}
            strokeWidth={3}
            strokeScaleEnabled={false}
            opacity={animated ? 0 : 0.6}
          />
        </Group>
      )}

      {animated && showWalker && active?.walker !== false && active && active.path.length > 1 && (
        <Group ref={walkerRef} opacity={0}>
          <Circle
            radius={px(9)}
            fill={theme.route}
            stroke={theme.routeCasing}
            strokeWidth={3}
            strokeScaleEnabled={false}
            shadowColor="#000000"
            shadowOpacity={0.3}
            shadowBlur={6}
          />
          <Line
            points={[-px(3), -px(4.5), px(4), 0, -px(3), px(4.5)]}
            closed
            fill={theme.routeCasing}
          />
        </Group>
      )}
    </Group>
  );
}

/* ------------------------------------------------------------------ */
/* Vị trí người dùng                                                    */
/* ------------------------------------------------------------------ */

export function LocationMarker({
  position,
  heading,
  theme,
  accuracy = 1.5,
  smooth = true,
}: {
  position: Point;
  heading?: number;
  theme: MapTheme;
  /** Bán kính sai số (m). */
  accuracy?: number;
  /** Trượt mượt tới vị trí mới thay vì nhảy (khi vị trí cập nhật liên tục, vd. đang đi). */
  smooth?: boolean;
}) {
  const px = usePx();
  const reducedMotion = usePrefersReducedMotion();
  const ref = useRef<Konva.Group>(null);
  const placed = useRef(false);
  const { x, y } = position;

  // Vị trí đặt qua ref (không qua props) để tween không bị React ghi đè.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (!placed.current || !smooth || reducedMotion) {
      placed.current = true;
      node.position({ x, y });
      node.getLayer()?.batchDraw();
      return;
    }
    const tween = new Konva.Tween({
      node,
      x,
      y,
      duration: 0.45,
      easing: Konva.Easings.EaseInOut,
    });
    tween.play();
    return () => tween.destroy();
  }, [x, y, smooth, reducedMotion]);

  return (
    <Group ref={ref} listening={false}>
      <Circle radius={accuracy} fill={withAlpha(theme.location, 0.15)} />
      {heading !== undefined && (
        <Wedge
          radius={px(34)}
          angle={60}
          rotation={heading - 30}
          fill={withAlpha(theme.location, 0.3)}
        />
      )}
      <Circle
        radius={px(9)}
        fill={theme.location}
        stroke="#ffffff"
        strokeWidth={px(3)}
        shadowColor="#000000"
        shadowOpacity={0.3}
        shadowBlur={px(6)}
      />
      {heading !== undefined && (
        <Line
          points={[-px(3), -px(4), px(4), 0, -px(3), px(4)]}
          closed
          fill="#ffffff"
          rotation={heading}
        />
      )}
    </Group>
  );
}
