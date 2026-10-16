import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import type { Building, BuildingSummary, Id } from '@hwn/map-core';
import { saveDraft, useSaveStatus } from './editor/draft';
import { useEditor } from './editor/store';
import { errorMessage } from './lib/api';
import { createBuilding, removeBuilding } from './lib/buildingActions';
import { useActiveBuildingId, useBuildings, useCampuses } from './lib/queries';

/** Chọn / thêm / đổi tên / xoá toà nhà — hiện trên thanh trên cùng của app admin. */
export function BuildingSwitcher({ building }: { building: Building | undefined }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const buildings = useBuildings();
  const campuses = useCampuses();
  const setBuildingId = useActiveBuildingId((s) => s.setBuildingId);
  const savePending = useSaveStatus((s) => s.pending);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Click ra ngoài / Esc thì đóng menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setAdding(false);
    setError(null);
  };

  // Đổi toà không mất gì: bản nháp của mọi toà được giữ lại, nút Lưu lưu tất cả.
  const switchTo = (id: Id) => {
    if (id === building?.id) return close();
    setBuildingId(id);
    close();
  };

  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createBuilding(queryClient, {
        name,
        address: String(form.get('address') ?? '').trim() || undefined,
        campusId: String(form.get('campusId') ?? '') || undefined,
      });
      if (!created) return;
      close();
      void navigate('/map');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const rename = () => {
    if (!building) return;
    const name = window.prompt('Tên toà nhà', building.name)?.trim();
    if (!name || name === building.name) return;
    const { dirty, edit } = useEditor.getState();
    if (dirty && !window.confirm('Đổi tên sẽ lưu luôn các thay đổi đang có. Tiếp tục?')) return;
    edit((b) => {
      b.name = name;
    });
    close();
    void saveDraft(queryClient);
  };

  const remove = async () => {
    if (!building || (buildings.data?.length ?? 0) <= 1) return;
    setBusy(true);
    setError(null);
    try {
      const next = buildings.data?.find((b) => b.id !== building.id)?.id ?? null;
      if (await removeBuilding(queryClient, building, next)) close();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const list = buildings.data ?? [];
  const canRemove = list.length > 1;
  const currentCampusId = list.find((b) => b.id === building?.id)?.campusId;
  // Nhóm toà theo cơ sở (theo thứ tự cơ sở), toà chưa thuộc cơ sở nào để cuối.
  const groups: { id: string; name: string; items: BuildingSummary[] }[] = [
    ...(campuses.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      items: list.filter((b) => b.campusId === c.id),
    })),
    { id: '', name: 'Chưa thuộc cơ sở nào', items: list.filter((b) => !b.campusId) },
  ].filter((g) => g.items.length);
  const showGroups = groups.length > 1 || (groups[0]?.id ?? '') !== '';

  return (
    <div className="building-switcher" ref={rootRef}>
      <button
        type="button"
        className="building-switcher-toggle"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={savePending}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="muted">Toà nhà:</span>
        <strong>{building?.name ?? 'Đang tải…'}</strong>
        <span aria-hidden>▾</span>
      </button>

      {open && (
        <div className="building-menu" role="menu">
          <div className="building-menu-list">
            {groups.map((g) => (
              <div key={g.id || 'none'} role="group" aria-label={g.name}>
                {showGroups && <div className="building-menu-group">{g.name}</div>}
                {g.items.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={b.id === building?.id}
                    className={`building-menu-item${b.id === building?.id ? ' active' : ''}`}
                    onClick={() => switchTo(b.id)}
                  >
                    <strong>{b.name}</strong>
                    <span className="muted small">
                      {b.floorCount} tầng{b.address ? ` · ${b.address}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            ))}
            {buildings.isPending && <p className="muted small">Đang tải danh sách…</p>}
          </div>

          {adding ? (
            <form className="building-menu-form" onSubmit={(e) => void create(e)}>
              <input
                name="name"
                placeholder="Tên toà nhà, vd. Khu C – Ngoại trú"
                required
                autoFocus
              />
              <input name="address" placeholder="Địa chỉ (không bắt buộc)" />
              {(campuses.data?.length ?? 0) > 0 && (
                <select name="campusId" defaultValue={currentCampusId ?? ''} aria-label="Cơ sở">
                  {campuses.data!.map((c) => (
                    <option key={c.id} value={c.id}>
                      Thuộc {c.name}
                    </option>
                  ))}
                  <option value="">Chưa thuộc cơ sở nào</option>
                </select>
              )}
              <div className="btn-row">
                <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                  Tạo toà nhà
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setAdding(false)}>
                  Huỷ
                </button>
              </div>
            </form>
          ) : (
            <div className="building-menu-actions">
              <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}>
                + Thêm toà nhà
              </button>
              <button type="button" className="btn btn-sm" onClick={rename} disabled={!building}>
                Đổi tên
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => void remove()}
                disabled={!canRemove || busy}
                title={canRemove ? undefined : 'Không thể xoá toà nhà cuối cùng'}
              >
                Xoá toà này
              </button>
              <Link to="/campuses" className="btn btn-sm" onClick={close}>
                Quản lý cơ sở…
              </Link>
            </div>
          )}
          {error && <p className="error small">{error}</p>}
        </div>
      )}
    </div>
  );
}
