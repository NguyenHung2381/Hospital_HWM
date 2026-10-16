import { useMemo, useState } from 'react';
import { sortedFloors, type Building, type Id, type TrafficSnapshot } from '@hwn/map-core';
import type { TrafficHistoryPoint, TrafficStreamStatus } from '@hwn/api-client';
import { errorMessage } from '../lib/api';
import { useActiveBuilding, useTrafficHistory } from '../lib/queries';
import { describeEdge } from '../traffic/describe';
import { HeatMap } from '../traffic/HeatMap';
import { LevelBadge } from '../traffic/LevelBadge';
import { DEFAULT_THRESHOLDS, levelOf, useThresholds, type Thresholds } from '../traffic/levels';
import { TrafficChart } from '../traffic/TrafficChart';
import { useTrafficStream, type LiveSample } from '../traffic/useTrafficStream';
import '../traffic/traffic.css';

const STATUS_TEXT: Record<TrafficStreamStatus, string> = {
  connecting: 'Đang kết nối…',
  live: 'Trực tiếp',
  polling: 'Cập nhật định kỳ',
  offline: 'Mất kết nối',
};

const hhmm = (t: number) =>
  new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
const hhmmss = (t: number) =>
  new Date(t).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

function LiveIndicator({ status, at }: { status: TrafficStreamStatus; at?: string }) {
  return (
    <span className={`live live-${status}`} role="status">
      <span className="live-dot" aria-hidden />
      {STATUS_TEXT[status]}
      {at && <span className="muted"> · {hhmmss(Date.parse(at))}</span>}
    </span>
  );
}

function ThresholdSettings({
  value,
  onChange,
}: {
  value: Thresholds;
  onChange: (t: Thresholds) => void;
}) {
  const [draft, setDraft] = useState(value);
  const valid = draft.busy >= 1 && draft.overload > draft.busy;
  return (
    <details className="popover">
      <summary className="btn btn-sm">Ngưỡng cảnh báo</summary>
      <div className="popover-body">
        <p className="muted small">Số người trên một đoạn đường để coi là…</p>
        <label className="pf">
          <span className="pf-label">Đông (từ)</span>
          <span className="pf-input">
            <input
              type="number"
              min={1}
              value={draft.busy}
              onChange={(e) => setDraft({ ...draft, busy: Number(e.target.value) })}
            />
          </span>
        </label>
        <label className="pf">
          <span className="pf-label">Quá tải (từ)</span>
          <span className="pf-input">
            <input
              type="number"
              min={2}
              value={draft.overload}
              onChange={(e) => setDraft({ ...draft, overload: Number(e.target.value) })}
            />
          </span>
        </label>
        {!valid && <p className="error small">Ngưỡng quá tải phải lớn hơn ngưỡng đông.</p>}
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!valid}
            onClick={() => onChange(draft)}
          >
            Áp dụng
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setDraft(DEFAULT_THRESHOLDS);
              onChange(DEFAULT_THRESHOLDS);
            }}
          >
            Mặc định
          </button>
        </div>
      </div>
    </details>
  );
}

interface Row {
  floorId: Id;
  floorName: string;
  edgeId: Id;
  place: string;
  count: number;
}

function busiestRows(building: Building, snapshot: TrafficSnapshot | null): Row[] {
  if (!snapshot) return [];
  const floors = new Map(building.floors.map((f) => [f.id, f]));
  return snapshot.edges
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count)
    .flatMap((e) => {
      const floor = floors.get(e.floorId);
      const info = floor && describeEdge(floor, e.edgeId);
      return floor && info
        ? [
            {
              floorId: floor.id,
              floorName: floor.name,
              edgeId: e.edgeId,
              place: info.place,
              count: e.count,
            },
          ]
        : [];
    });
}

function peakOfToday(history: readonly TrafficHistoryPoint[] | undefined) {
  const today = new Date().toDateString();
  let peak: TrafficHistoryPoint | undefined;
  for (const p of history ?? []) {
    if (new Date(p.timestamp).toDateString() !== today) continue;
    if (!peak || p.totalActive > peak.totalActive) peak = p;
  }
  return peak;
}

function StatTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
}) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <span className="stat-number">{value}</span>
      {detail && <span className="stat-detail">{detail}</span>}
    </div>
  );
}

export function TrafficPage() {
  const building = useActiveBuilding();
  const b = building.data;
  const { snapshot, status, samples } = useTrafficStream(b?.id);
  const history = useTrafficHistory(b?.id);
  const [thresholds, setThresholds] = useThresholds();
  const floors = useMemo(() => (b ? sortedFloors(b) : []), [b]);
  const [floorId, setFloorId] = useState<Id | null>(null);
  const [range, setRange] = useState<'live' | 'day'>('live');
  const [showTable, setShowTable] = useState(false);

  const rows = useMemo(() => (b ? busiestRows(b, snapshot) : []), [b, snapshot]);
  const perFloor = useMemo(() => {
    const m = new Map<Id, number>();
    for (const e of snapshot?.edges ?? []) m.set(e.floorId, (m.get(e.floorId) ?? 0) + e.count);
    return m;
  }, [snapshot]);

  if (building.isPending) return <p className="muted">Đang tải…</p>;
  if (building.isError || !b) return <p className="error">{errorMessage(building.error)}</p>;

  const floor = floors.find((f) => f.id === floorId) ?? floors[0];
  const overloaded = rows.filter((r) => levelOf(r.count, thresholds) === 'overload');
  const busy = rows.filter((r) => levelOf(r.count, thresholds) === 'busy');
  const top = rows[0];
  const peak = peakOfToday(history.data);

  const chartData: { t: number; v: number }[] =
    range === 'live'
      ? samples.map((s: LiveSample) => ({ t: s.t, v: s.total }))
      : (history.data ?? []).map((p) => ({ t: Date.parse(p.timestamp), v: p.totalActive }));

  return (
    <div className="stack">
      <header className="traffic-header">
        <h1>Lưu lượng</h1>
        <LiveIndicator status={status} at={snapshot?.timestamp} />
        <span className="spacer" />
        <ThresholdSettings value={thresholds} onChange={setThresholds} />
      </header>

      {overloaded.length > 0 && (
        <div className="traffic-alert" role="alert">
          <LevelBadge level="overload" />
          <span>
            {overloaded.length === 1
              ? `${overloaded[0]!.place} (${overloaded[0]!.floorName}) đang có ${overloaded[0]!.count} người.`
              : `${overloaded.length} đoạn đường đang quá tải — đông nhất: ${overloaded[0]!.place} (${overloaded[0]!.floorName}), ${overloaded[0]!.count} người.`}
          </span>
        </div>
      )}

      <div className="stat-row">
        <StatTile
          label="Đang di chuyển"
          value={snapshot?.totalActive ?? '—'}
          detail={floors.map((f) => `${f.name}: ${perFloor.get(f.id) ?? 0}`).join(' · ')}
        />
        <StatTile
          label="Đoạn đông nhất"
          value={top ? `${top.count} người` : '—'}
          detail={top && `${top.place} · ${top.floorName}`}
        />
        <StatTile
          label="Đoạn đông / quá tải"
          value={`${busy.length} / ${overloaded.length}`}
          detail={`Ngưỡng: đông ≥ ${thresholds.busy}, quá tải ≥ ${thresholds.overload}`}
        />
        <StatTile
          label="Cao điểm hôm nay"
          value={peak ? `${peak.totalActive} người` : '—'}
          detail={peak ? `lúc ${hhmm(Date.parse(peak.timestamp))}` : 'chưa có dữ liệu'}
        />
      </div>

      <div className="traffic-grid">
        <section className="card">
          <div className="card-header">
            <h2>Bản đồ mật độ</h2>
            <div className="seg" role="group" aria-label="Chọn tầng">
              {[...floors].reverse().map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={f.id === floor?.id ? 'active' : ''}
                  aria-pressed={f.id === floor?.id}
                  onClick={() => setFloorId(f.id)}
                >
                  {f.name} <span className="seg-count">{perFloor.get(f.id) ?? 0}</span>
                </button>
              ))}
            </div>
          </div>
          {floor && (
            <HeatMap floor={floor} traffic={snapshot?.edges ?? []} thresholds={thresholds} />
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <h2>Số người đang di chuyển</h2>
            <div className="seg" role="group" aria-label="Khoảng thời gian">
              <button
                type="button"
                className={range === 'live' ? 'active' : ''}
                aria-pressed={range === 'live'}
                onClick={() => setRange('live')}
              >
                10 phút qua
              </button>
              <button
                type="button"
                className={range === 'day' ? 'active' : ''}
                aria-pressed={range === 'day'}
                onClick={() => setRange('day')}
              >
                24 giờ
              </button>
            </div>
          </div>
          {range === 'day' && history.isError && (
            <p className="error">{errorMessage(history.error)}</p>
          )}
          <TrafficChart
            data={chartData}
            formatTime={range === 'live' ? hhmmss : hhmm}
            valueLabel={(v) => `${v} người`}
            ariaLabel={
              range === 'live'
                ? 'Số người đang di chuyển trong 10 phút qua'
                : 'Số người đang di chuyển trung bình mỗi 15 phút trong 24 giờ qua'
            }
          />
          <button
            type="button"
            className="link-button small"
            onClick={() => setShowTable((v) => !v)}
          >
            {showTable ? 'Ẩn bảng số liệu' : 'Xem dạng bảng'}
          </button>
          {showTable && (
            <div className="table-scroll chart-table">
              <table className="table">
                <thead>
                  <tr>
                    <th>Thời điểm</th>
                    <th>Số người</th>
                  </tr>
                </thead>
                <tbody>
                  {[...chartData].reverse().map((d) => (
                    <tr key={d.t}>
                      <td>{(range === 'live' ? hhmmss : hhmm)(d.t)}</td>
                      <td className="num">{d.v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="card">
        <h2>Các đoạn đông nhất</h2>
        {rows.length === 0 ? (
          <p className="muted">Hiện không có ai di chuyển.</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Vị trí</th>
                  <th>Tầng</th>
                  <th className="num">Số người</th>
                  <th>Mức</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 10).map((r) => (
                  <tr key={`${r.floorId}:${r.edgeId}`}>
                    <td>{r.place}</td>
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => setFloorId(r.floorId)}
                      >
                        {r.floorName}
                      </button>
                    </td>
                    <td className="num">{r.count}</td>
                    <td>
                      <LevelBadge level={levelOf(r.count, thresholds)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
