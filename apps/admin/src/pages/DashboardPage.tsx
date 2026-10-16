import { useMemo } from 'react';
import { sortedFloors, validateBuilding } from '@hwn/map-core';
import { errorMessage } from '../lib/api';
import { useActiveBuilding } from '../lib/queries';

export function DashboardPage() {
  const building = useActiveBuilding();
  const validation = useMemo(
    () => (building.data ? validateBuilding(building.data) : null),
    [building.data],
  );

  if (building.isPending) return <p className="muted">Đang tải…</p>;
  if (building.isError) return <p className="error">{errorMessage(building.error)}</p>;
  const b = building.data;

  return (
    <div className="stack">
      <h1>Tổng quan</h1>

      <section className="card">
        <h2>Các tầng</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Tầng</th>
              <th>Cao độ</th>
              <th>Tường</th>
              <th>Cửa</th>
              <th>Thang</th>
              <th>Phòng</th>
              <th>Nút / cạnh đồ thị</th>
            </tr>
          </thead>
          <tbody>
            {sortedFloors(b).map((f) => (
              <tr key={f.id}>
                <td>{f.name}</td>
                <td>{f.elevation} m</td>
                <td>{f.walls.length}</td>
                <td>{f.openings.length}</td>
                <td>{f.connectors.length}</td>
                <td>{f.rooms.length}</td>
                <td>
                  {f.navGraph.nodes.length} / {f.navGraph.edges.length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">
          {b.departments.length} khoa · phiên bản {b.version} · cập nhật{' '}
          {new Date(b.updatedAt).toLocaleString('vi-VN')}
        </p>
      </section>

      <section className="card">
        <h2>Kiểm tra dữ liệu bản đồ</h2>
        {validation?.issues.length === 0 ? (
          <p className="ok">✓ Không phát hiện lỗi</p>
        ) : (
          <ul className="issues">
            {validation?.issues.map((issue, i) => (
              <li key={i} className={issue.severity}>
                <strong>{issue.severity === 'error' ? 'Lỗi' : 'Cảnh báo'}:</strong> {issue.message}
                <span className="muted"> ({issue.code})</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
