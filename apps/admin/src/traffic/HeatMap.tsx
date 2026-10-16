import { useMemo, useRef, useState } from 'react';
import { Circle, Group, Layer, Line, Text } from 'react-konva';
import {
  projectPointOnSegment,
  type EdgeTraffic,
  type Floor,
  type Id,
  type Point,
} from '@hwn/map-core';
import {
  Connectors,
  floorBounds,
  flattenPoints,
  Labels,
  MapStage,
  Rooms,
  usePrefersDark,
  usePx,
  useMapTheme,
  Walls,
  type MapStageHandle,
} from '@hwn/map-render';
import { describeEdge } from './describe';
import { HEAT_RAMP, heatBin, heatBinRanges, LEVEL_STYLE, levelOf, type Thresholds } from './levels';
import { LevelBadge } from './LevelBadge';

interface HeatEdgesProps {
  floor: Floor;
  counts: ReadonlyMap<Id, number>;
  thresholds: Thresholds;
  ramp: readonly string[];
  idleColor: string;
  hovered: Id | null;
}

function HeatEdges({ floor, counts, thresholds, ramp, idleColor, hovered }: HeatEdgesProps) {
  const px = usePx();
  const nodes = useMemo(
    () => new Map(floor.navGraph.nodes.map((n) => [n.id, n.position])),
    [floor.navGraph.nodes],
  );
  const edges = floor.navGraph.edges
    .map((e) => ({ e, a: nodes.get(e.from), b: nodes.get(e.to), count: counts.get(e.id) ?? 0 }))
    .filter((x): x is typeof x & { a: Point; b: Point } => !!x.a && !!x.b)
    // Vẽ đoạn đông sau cùng để nằm trên.
    .sort((x, y) => x.count - y.count);

  return (
    <Group listening={false}>
      {edges.map(({ e, a, b, count }) => {
        const bin = heatBin(count, thresholds);
        const isHovered = e.id === hovered;
        return (
          <Group key={e.id}>
            {isHovered && (
              <Line
                points={flattenPoints([a, b])}
                stroke="#ffffff"
                strokeWidth={4 + 2 * Math.max(bin, 0) + 6}
                lineCap="round"
                opacity={0.9}
                strokeScaleEnabled={false}
              />
            )}
            <Line
              points={flattenPoints([a, b])}
              stroke={bin < 0 ? idleColor : ramp[bin]}
              strokeWidth={bin < 0 ? 2 : 4 + 2 * bin}
              dash={bin < 0 ? [px(4), px(4)] : undefined}
              lineCap="round"
              strokeScaleEnabled={false}
            />
          </Group>
        );
      })}
      {edges
        .filter(({ count }) => levelOf(count, thresholds) === 'overload')
        .map(({ e, a, b }) => (
          <Group key={`badge:${e.id}`} x={(a.x + b.x) / 2} y={(a.y + b.y) / 2}>
            <Circle
              radius={px(9)}
              fill={LEVEL_STYLE.overload.color}
              stroke="#ffffff"
              strokeWidth={px(2)}
            />
            <Text
              text="!"
              x={-px(9)}
              y={-px(7)}
              width={px(18)}
              align="center"
              fontSize={px(13)}
              fontStyle="bold"
              fill="#ffffff"
            />
          </Group>
        ))}
    </Group>
  );
}

/** Bản đồ một tầng với các đoạn đường tô màu theo số người, có tooltip khi rê chuột. */
export function HeatMap({
  floor,
  traffic,
  thresholds,
}: {
  floor: Floor;
  traffic: readonly EdgeTraffic[];
  thresholds: Thresholds;
}) {
  const theme = useMapTheme('auto');
  const dark = usePrefersDark();
  const ramp = dark ? HEAT_RAMP.dark : HEAT_RAMP.light;
  const stageRef = useRef<MapStageHandle>(null);
  const [hover, setHover] = useState<{ edgeId: Id; screen: Point } | null>(null);

  const counts = useMemo(
    () => new Map(traffic.filter((t) => t.floorId === floor.id).map((t) => [t.edgeId, t.count])),
    [traffic, floor.id],
  );
  const bounds = useMemo(() => floorBounds(floor), [floor]);
  const segments = useMemo(() => {
    const nodes = new Map(floor.navGraph.nodes.map((n) => [n.id, n.position]));
    return floor.navGraph.edges.flatMap((e) => {
      const a = nodes.get(e.from);
      const b = nodes.get(e.to);
      return a && b ? [{ id: e.id, a, b }] : [];
    });
  }, [floor]);

  const onMove = (p: Point | null) => {
    const t = stageRef.current?.getTransform();
    if (!p || !t) return setHover(null);
    const tol = 10 / t.scale; // 10 px
    let best: { id: Id; d: number } | null = null;
    for (const s of segments) {
      const d = projectPointOnSegment(p, s.a, s.b).distance;
      if (d <= tol && (!best || d < best.d)) best = { id: s.id, d };
    }
    setHover(
      best ? { edgeId: best.id, screen: { x: p.x * t.scale + t.x, y: p.y * t.scale + t.y } } : null,
    );
  };

  const info = hover ? describeEdge(floor, hover.edgeId) : null;
  const count = hover ? (counts.get(hover.edgeId) ?? 0) : 0;
  const ranges = heatBinRanges(thresholds);

  return (
    <div className="heatmap">
      <div className="heatmap-stage">
        <MapStage
          ref={stageRef}
          bounds={bounds}
          fitKey={floor.id}
          background={theme.background}
          onWorldPointerMove={onMove}
        >
          <Layer listening={false}>
            {/* Phòng tô màu trung tính để không lẫn với thang màu heatmap. */}
            <Rooms rooms={floor.rooms} theme={theme} />
            <Connectors connectors={floor.connectors} theme={theme} />
            <Walls floor={floor} theme={theme} />
            <Labels floor={floor} theme={theme} />
          </Layer>
          <Layer listening={false}>
            <HeatEdges
              floor={floor}
              counts={counts}
              thresholds={thresholds}
              ramp={ramp}
              idleColor={theme.roomStroke}
              hovered={hover?.edgeId ?? null}
            />
          </Layer>
        </MapStage>
        {hover && info && (
          <div
            className="heat-tooltip"
            role="status"
            style={{ left: hover.screen.x, top: hover.screen.y }}
          >
            <strong>{count} người</strong>
            <LevelBadge level={levelOf(count, thresholds)} />
            <span className="muted">{info.place}</span>
          </div>
        )}
      </div>
      <div className="heat-legend" aria-label="Chú giải số người trên mỗi đoạn">
        <span className="muted small">Người / đoạn:</span>
        <span className="heat-legend-item">
          <span className="heat-swatch idle" style={{ borderColor: theme.roomStroke }} /> 0
        </span>
        {ramp.map((color, i) =>
          // Ngưỡng nhỏ có thể làm vài mức không chứa số nguyên nào → ẩn khỏi chú giải.
          ranges[i] === '—' ? null : (
            <span key={color} className="heat-legend-item">
              <span className="heat-swatch" style={{ background: color, height: 4 + 2 * i }} />
              {ranges[i]}
            </span>
          ),
        )}
        <span className="heat-legend-item">
          <span className="heat-badge">!</span> quá tải
        </span>
      </div>
    </div>
  );
}
