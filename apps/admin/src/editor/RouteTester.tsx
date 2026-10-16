import { sortedFloors, type Building } from '@hwn/map-core';
import { CheckField, Panel } from './fields';
import { ENTRANCE, type computeTestRoute, type RouteQuery } from './routeTest';

export function RouteTester({
  building,
  query,
  onChange,
  result,
}: {
  building: Building;
  query: RouteQuery;
  onChange: (q: RouteQuery) => void;
  result: ReturnType<typeof computeTestRoute>;
}) {
  const options = sortedFloors(building).flatMap((f) =>
    f.rooms.map((r) => ({ id: r.id, label: `${r.code} – ${r.name} (${f.name})` })),
  );
  const route = result && 'route' in result ? result.route : null;

  return (
    <Panel title="Thử chỉ đường">
      <label className="pf">
        <span className="pf-label">Từ</span>
        <span className="pf-input">
          <select
            value={query.fromId}
            onChange={(e) => onChange({ ...query, fromId: e.target.value })}
          >
            <option value={ENTRANCE}>Cửa chính</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </span>
      </label>
      <label className="pf">
        <span className="pf-label">Đến</span>
        <span className="pf-input">
          <select value={query.toId} onChange={(e) => onChange({ ...query, toId: e.target.value })}>
            <option value="">— Chọn phòng —</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </span>
      </label>
      <CheckField
        label="Chỉ lối đi cho xe lăn"
        checked={query.accessibleOnly}
        onChange={(accessibleOnly) => onChange({ ...query, accessibleOnly })}
      />
      {result && 'error' in result && <p className="error small">{result.error}</p>}
      {route && (
        <>
          <p className="muted small">
            {Math.round(route.distance)} m · ~{Math.max(1, Math.round(route.estimatedSeconds / 60))}{' '}
            phút · tuyến được vẽ trên bản đồ
          </p>
          <ol className="steps small">
            {route.instructions.map((s, i) => (
              <li key={i}>{s.text}</li>
            ))}
          </ol>
        </>
      )}
      <p className="muted small">Dùng bản nháp hiện tại (kể cả thay đổi chưa lưu).</p>
    </Panel>
  );
}
