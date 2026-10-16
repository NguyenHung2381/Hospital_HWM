import { useId, useMemo, useRef, useState } from 'react';
import { useElementSize } from '@hwn/map-render';
import { niceTicks } from './scale';

export interface ChartPoint {
  t: number;
  v: number;
}

const M = { top: 12, right: 16, bottom: 28, left: 40 };

/**
 * Biểu đồ đường + vùng cho MỘT chuỗi số liệu theo thời gian (không cần chú giải — tiêu đề
 * card đã nói rõ). Rê chuột/chạm để xem giá trị tại từng thời điểm.
 */
export function TrafficChart({
  data,
  formatTime,
  valueLabel,
  height = 220,
  ariaLabel,
}: {
  data: readonly ChartPoint[];
  formatTime: (t: number) => string;
  valueLabel: (v: number) => string;
  height?: number;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(ref);
  const [hover, setHover] = useState<number | null>(null);
  const gradientId = useId();

  const geom = useMemo(() => {
    if (data.length < 2 || width <= 0) return null;
    const t0 = data[0]!.t;
    const t1 = data[data.length - 1]!.t;
    const ticks = niceTicks(Math.max(...data.map((d) => d.v)));
    const yMax = ticks[ticks.length - 1]!;
    const w = width - M.left - M.right;
    const h = height - M.top - M.bottom;
    const x = (t: number) => M.left + ((t - t0) / (t1 - t0 || 1)) * w;
    const y = (v: number) => M.top + h - (v / (yMax || 1)) * h;
    const line = data
      .map((d, i) => `${i ? 'L' : 'M'}${x(d.t).toFixed(1)},${y(d.v).toFixed(1)}`)
      .join('');
    const area = `${line}L${x(t1).toFixed(1)},${y(0)}L${x(t0).toFixed(1)},${y(0)}Z`;
    // ~5 nhãn thời gian cách đều.
    const xTicks = Array.from({ length: 5 }, (_, i) => t0 + ((t1 - t0) * i) / 4);
    return { x, y, ticks, line, area, xTicks, w, h };
  }, [data, width, height]);

  const onPointer = (clientX: number) => {
    if (!geom || !ref.current) return;
    const px = clientX - ref.current.getBoundingClientRect().left;
    // Điểm gần con trỏ nhất theo trục thời gian.
    let best = 0;
    for (let i = 1; i < data.length; i++) {
      if (Math.abs(geom.x(data[i]!.t) - px) < Math.abs(geom.x(data[best]!.t) - px)) best = i;
    }
    setHover(best);
  };

  const point = hover !== null ? data[hover] : undefined;

  return (
    <div ref={ref} className="chart" style={{ height }}>
      {!geom ? (
        <p className="muted chart-empty">Đang thu thập dữ liệu…</p>
      ) : (
        <>
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={ariaLabel}
            onPointerMove={(e) => onPointer(e.clientX)}
            onPointerDown={(e) => onPointer(e.clientX)}
            onPointerLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="var(--chart-series)" stopOpacity="0.22" />
                <stop offset="1" stopColor="var(--chart-series)" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {geom.ticks.map((v) => (
              <g key={v}>
                <line
                  x1={M.left}
                  x2={M.left + geom.w}
                  y1={geom.y(v)}
                  y2={geom.y(v)}
                  className={v === 0 ? 'chart-baseline' : 'chart-grid'}
                />
                <text
                  x={M.left - 8}
                  y={geom.y(v)}
                  className="chart-tick"
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  {v}
                </text>
              </g>
            ))}
            {geom.xTicks.map((t, i) => (
              <text
                key={t}
                x={geom.x(t)}
                y={height - 8}
                className="chart-tick"
                textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}
              >
                {formatTime(t)}
              </text>
            ))}
            <path d={geom.area} fill={`url(#${gradientId})`} />
            <path d={geom.line} className="chart-line" />
            {point && (
              <g>
                <line
                  x1={geom.x(point.t)}
                  x2={geom.x(point.t)}
                  y1={M.top}
                  y2={M.top + geom.h}
                  className="chart-crosshair"
                />
                <circle cx={geom.x(point.t)} cy={geom.y(point.v)} r={5} className="chart-dot" />
              </g>
            )}
          </svg>
          {point && (
            <div
              className="chart-tooltip"
              style={{
                left: Math.min(Math.max(geom.x(point.t), 70), width - 70),
                top: Math.max(geom.y(point.v) - 12, 0),
              }}
            >
              <span className="muted">{formatTime(point.t)}</span>
              <strong>{valueLabel(point.v)}</strong>
            </div>
          )}
        </>
      )}
    </div>
  );
}
