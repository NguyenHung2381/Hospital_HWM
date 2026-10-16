import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  normalizeText,
  polygonArea,
  sortedFloors,
  type Building,
  type Department,
  type Id,
} from '@hwn/map-core';
import { saveDraft } from '../editor/draft';
import { useEditor } from '../editor/store';
import { api, errorMessage } from '../lib/api';

/** Bảng màu gợi ý cho khoa mới (xoay vòng). */
const PALETTE = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#8b5cf6',
  '#14b8a6',
  '#ef4444',
  '#84cc16',
];
const ALL = '__all__';
const NONE = '__none__';

/** Ô nhập trong bảng — chỉ ghi khi rời ô / Enter (mỗi lần sửa = một bước undo). */
function InlineText({
  value,
  onCommit,
  placeholder,
  allowEmpty = false,
  label,
  wide = false,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  label: string;
  wide?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const v = text.trim();
    setText(null);
    if ((v || allowEmpty) && v !== value) onCommit(v);
  };
  return (
    <input
      className={`cell-input${wide ? ' wide' : ''}`}
      aria-label={label}
      value={text ?? value}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setText(null);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function ColorInput({
  value,
  onCommit,
  label,
}: {
  value: string;
  onCommit: (v: string) => void;
  label: string;
}) {
  const [color, setColor] = useState<string | null>(null);
  return (
    <input
      type="color"
      className="color-input"
      aria-label={label}
      value={color ?? value}
      onChange={(e) => setColor(e.target.value)}
      onBlur={() => {
        if (color && color !== value) onCommit(color);
        setColor(null);
      }}
    />
  );
}

/* ------------------------------------------------------------------ */

/**
 * Danh mục khoa dùng chung cho mọi toà nhà: thêm / sửa / xoá được ghi thẳng lên server
 * (không qua bản nháp, không cần bấm Lưu). Việc gán phòng cho khoa vẫn nằm trong bản nháp của toà.
 */
function DepartmentsTable({ building }: { building: Building }) {
  const queryClient = useQueryClient();
  const edit = useEditor((s) => s.edit);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const roomCount = useMemo(() => {
    const counts = new Map<Id, number>();
    for (const r of building.floors.flatMap((f) => f.rooms)) {
      if (r.departmentId) counts.set(r.departmentId, (counts.get(r.departmentId) ?? 0) + 1);
    }
    return counts;
  }, [building]);

  /** Gọi API rồi nạp lại danh mục vào bản nháp (không làm bản nháp thành "chưa lưu"). */
  const apply = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      useEditor.getState().syncDepartments(await api.departmentCatalog.list());
      void queryClient.invalidateQueries({ queryKey: ['active-building'] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const patch = (id: Id, p: Partial<Department>) => {
    const d = building.departments.find((x) => x.id === id);
    if (d) void apply(() => api.departmentCatalog.update({ ...d, ...p }));
  };

  const add = () =>
    void apply(() =>
      api.departmentCatalog.create({
        name: `Khoa mới ${building.departments.length + 1}`,
        code: '',
        color: PALETTE[building.departments.length % PALETTE.length]!,
      }),
    );

  const remove = async (d: Department) => {
    const n = roomCount.get(d.id) ?? 0;
    const msg = n
      ? `Xoá "${d.name}" khỏi danh mục khoa (mọi toà nhà)? ${n} phòng của toà này sẽ chuyển thành khu vực chung và bản đồ được lưu ngay.`
      : `Xoá "${d.name}" khỏi danh mục khoa (mọi toà nhà)?`;
    if (!window.confirm(msg)) return;
    if (n) {
      // Server chỉ cho xoá khoa không còn phòng nào — gỡ khoa khỏi các phòng rồi lưu toà trước.
      edit((b) => {
        for (const r of b.floors.flatMap((f) => f.rooms)) {
          if (r.departmentId === d.id) r.departmentId = null;
        }
      });
      if (!(await saveDraft(queryClient))) {
        setError('Chưa lưu được bản đồ nên chưa xoá khoa. Xem thông báo lỗi phía trên.');
        return;
      }
    }
    await apply(() => api.departmentCatalog.remove(d.id));
  };

  return (
    <section className="card">
      <div className="card-header">
        <h2>Danh mục khoa ({building.departments.length})</h2>
        <button type="button" className="btn btn-sm btn-primary" onClick={add} disabled={busy}>
          + Thêm khoa
        </button>
      </div>
      <p className="muted small">
        Dùng chung cho mọi toà nhà — thay đổi ở đây được lưu ngay, không cần bấm Lưu.
      </p>
      {error && <p className="error small">{error}</p>}
      <table className="table">
        <thead>
          <tr>
            <th>Màu</th>
            <th>Tên khoa</th>
            <th>Mã</th>
            <th title="Số phòng thuộc khoa ở toà đang xem">Phòng (toà này)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {building.departments.map((d) => (
            <tr key={d.id}>
              <td>
                <ColorInput
                  value={d.color}
                  label={`Màu ${d.name}`}
                  onCommit={(color) => patch(d.id, { color })}
                />
              </td>
              <td>
                <InlineText
                  value={d.name}
                  label="Tên khoa"
                  wide
                  onCommit={(name) => patch(d.id, { name })}
                />
              </td>
              <td>
                <InlineText
                  value={d.code}
                  label="Mã khoa"
                  allowEmpty
                  placeholder="—"
                  onCommit={(code) => patch(d.id, { code })}
                />
              </td>
              <td>{roomCount.get(d.id) ?? 0}</td>
              <td>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  disabled={busy}
                  onClick={() => void remove(d)}
                >
                  Xoá
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function RoomsTable({ building }: { building: Building }) {
  const edit = useEditor((s) => s.edit);
  const [query, setQuery] = useState('');
  const [floorFilter, setFloorFilter] = useState(ALL);
  const [deptFilter, setDeptFilter] = useState(ALL);
  const [checked, setChecked] = useState<Set<Id>>(new Set());
  const [bulkDept, setBulkDept] = useState(NONE);

  const departments = useMemo(
    () => new Map(building.departments.map((d) => [d.id, d])),
    [building.departments],
  );
  const rows = useMemo(() => {
    const q = normalizeText(query);
    return sortedFloors(building).flatMap((floor) => {
      if (floorFilter !== ALL && floor.id !== floorFilter) return [];
      const reachable = new Set(
        floor.navGraph.nodes
          .filter(
            (n) =>
              n.kind === 'room' &&
              floor.navGraph.edges.some((e) => e.from === n.id || e.to === n.id),
          )
          .map((n) => n.refId),
      );
      return floor.rooms
        .filter(
          (r) =>
            deptFilter === ALL ||
            (deptFilter === NONE ? !r.departmentId : r.departmentId === deptFilter),
        )
        .filter((r) => {
          if (!q) return true;
          const dept = r.departmentId ? departments.get(r.departmentId) : undefined;
          return normalizeText([r.name, r.code, ...r.tags, dept?.name ?? ''].join(' ')).includes(q);
        })
        .map((room) => ({ room, floor, reachable: reachable.has(room.id) }));
    });
  }, [building, query, floorFilter, deptFilter, departments]);

  const patchRoom = (roomId: Id, recipe: (r: (typeof rows)[number]['room']) => void) =>
    edit((b) => {
      const r = b.floors.flatMap((f) => f.rooms).find((x) => x.id === roomId);
      if (r) recipe(r);
    });

  const visibleIds = rows.map((r) => r.room.id);
  const checkedVisible = visibleIds.filter((id) => checked.has(id));
  const toggle = (id: Id) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const assignBulk = () => {
    const ids = new Set(checkedVisible);
    edit((b) => {
      for (const r of b.floors.flatMap((f) => f.rooms)) {
        if (ids.has(r.id)) r.departmentId = bulkDept === NONE ? null : bulkDept;
      }
    });
    setChecked(new Set());
  };

  const deptOptions = (
    <>
      <option value={NONE}>— Khu vực chung —</option>
      {building.departments.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </>
  );

  return (
    <section className="card">
      <div className="card-header">
        <h2>Phòng ({rows.length})</h2>
        <span className="muted small">Vẽ phòng mới ở trang Bản đồ (công cụ R hoặc F)</span>
      </div>
      <div className="filters">
        <input
          className="filter-input"
          type="search"
          placeholder="Tìm tên, mã, từ khoá, khoa…"
          aria-label="Tìm phòng"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Lọc theo tầng"
          value={floorFilter}
          onChange={(e) => setFloorFilter(e.target.value)}
        >
          <option value={ALL}>Tất cả tầng</option>
          {sortedFloors(building).map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Lọc theo khoa"
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
        >
          <option value={ALL}>Tất cả khoa</option>
          {deptOptions}
        </select>
      </div>

      {checkedVisible.length > 0 && (
        <div className="bulk-bar">
          <span>Đã chọn {checkedVisible.length} phòng · gán vào</span>
          <select
            aria-label="Khoa để gán"
            value={bulkDept}
            onChange={(e) => setBulkDept(e.target.value)}
          >
            {deptOptions}
          </select>
          <button type="button" className="btn btn-sm btn-primary" onClick={assignBulk}>
            Gán
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setChecked(new Set())}>
            Bỏ chọn
          </button>
        </div>
      )}

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Chọn tất cả"
                  checked={visibleIds.length > 0 && checkedVisible.length === visibleIds.length}
                  onChange={(e) => setChecked(e.target.checked ? new Set(visibleIds) : new Set())}
                />
              </th>
              <th>Mã</th>
              <th>Tên phòng</th>
              <th>Tầng</th>
              <th>Khoa</th>
              <th>Diện tích</th>
              <th>Chỉ đường</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ room, floor, reachable }) => {
              const dept = room.departmentId ? departments.get(room.departmentId) : undefined;
              return (
                <tr key={room.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Chọn ${room.name}`}
                      checked={checked.has(room.id)}
                      onChange={() => toggle(room.id)}
                    />
                  </td>
                  <td>
                    <InlineText
                      value={room.code}
                      label="Mã phòng"
                      allowEmpty
                      placeholder="—"
                      onCommit={(code) => patchRoom(room.id, (r) => void (r.code = code))}
                    />
                  </td>
                  <td>
                    <InlineText
                      value={room.name}
                      label="Tên phòng"
                      wide
                      onCommit={(name) => patchRoom(room.id, (r) => void (r.name = name))}
                    />
                  </td>
                  <td>{floor.name}</td>
                  <td>
                    <span className="cell-dept">
                      <span className="dot" style={{ background: dept?.color ?? 'transparent' }} />
                      <select
                        aria-label="Khoa"
                        value={room.departmentId ?? NONE}
                        onChange={(e) =>
                          patchRoom(
                            room.id,
                            (r) =>
                              void (r.departmentId =
                                e.target.value === NONE ? null : e.target.value),
                          )
                        }
                      >
                        {deptOptions}
                      </select>
                    </span>
                  </td>
                  <td>{polygonArea(room.polygon).toFixed(1)} m²</td>
                  <td>
                    {reachable ? (
                      <span className="ok">✓</span>
                    ) : (
                      <span className="warn" title="Phòng chưa nối vào đồ thị đi lại">
                        Chưa nối
                      </span>
                    )}
                  </td>
                  <td>
                    <Link to={`/map?room=${room.id}`} className="btn btn-sm">
                      Trên bản đồ
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

export function DepartmentsPage() {
  const building = useEditor((s) => s.building);
  if (!building) return <p className="muted">Đang tải…</p>;
  return (
    <div className="stack">
      <h1>Khoa phòng</h1>
      <div className="dept-layout">
        <DepartmentsTable building={building} />
        <RoomsTable building={building} />
      </div>
    </div>
  );
}
