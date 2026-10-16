import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import {
  externalMapUrl,
  nextPlacementPosition,
  type BuildingSummary,
  type GeoPoint,
  type Id,
} from '@hwn/map-core';
import { SiteMap } from '@hwn/map-render';
import { api, errorMessage } from '../lib/api';
import { campusDoc, siteBuildingsOf } from '../lib/campus';
import { openMap } from '../site/openMap';
import { invalidateStructure, useBuildings, useCampus, useCampuses } from '../lib/queries';

/** Chuyển toà sang cơ sở khác (đặt bên phải các toà có sẵn); `campusId` null = gỡ khỏi cơ sở. */
async function moveBuilding(buildingId: Id, from: Id | undefined, to: Id | null) {
  if (to) {
    const target = await api.campuses.get(to);
    const footprints = new Map(target.buildingInfo.map((i) => [i.id, i.footprint]));
    await api.campuses.save({
      ...campusDoc(target),
      buildings: [
        ...target.buildings,
        { buildingId, position: nextPlacementPosition(target, footprints), rotation: 0 },
      ],
    });
  } else if (from) {
    const source = await api.campuses.get(from);
    await api.campuses.save({
      ...campusDoc(source),
      buildings: source.buildings.filter((pl) => pl.buildingId !== buildingId),
    });
  }
}

const parseGeo = (lat: string, lng: string): GeoPoint | undefined =>
  lat.trim() && lng.trim() ? { lat: Number(lat), lng: Number(lng) } : undefined;

/* ------------------------------------------------------------------ */

function BuildingRow({
  building,
  campusId,
  onError,
}: {
  building: BuildingSummary;
  campusId?: Id;
  onError: (message: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const campuses = useCampuses();
  const [busy, setBusy] = useState(false);

  const open = () => openMap(navigate, building.id, 'building');

  const move = async (to: string) => {
    setBusy(true);
    onError(null);
    try {
      await moveBuilding(building.id, campusId, to || null);
      await invalidateStructure(queryClient);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const others = (campuses.data ?? []).filter((c) => c.id !== campusId);
  return (
    <li className="campus-building">
      <span className="campus-building-main">
        <strong>{building.name}</strong>
        <span className="muted small">{building.floorCount} tầng</span>
      </span>
      <button type="button" className="btn btn-sm" onClick={open}>
        Mở bản đồ
      </button>
      <select
        className="campus-move"
        aria-label={`Chuyển ${building.name} sang cơ sở khác`}
        value=""
        disabled={busy}
        onChange={(e) => void move(e.target.value)}
      >
        <option value="" disabled>
          Chuyển…
        </option>
        {others.map((c) => (
          <option key={c.id} value={c.id}>
            Sang {c.name}
          </option>
        ))}
        {campusId && <option value="">Gỡ khỏi cơ sở</option>}
      </select>
    </li>
  );
}

/* ------------------------------------------------------------------ */

function CampusCard({ campusId, buildings }: { campusId: Id; buildings: BuildingSummary[] }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const campus = useCampus(campusId);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (campus.isPending) return <section className="card muted">Đang tải…</section>;
  if (campus.isError) return <section className="card error">{errorMessage(campus.error)}</section>;
  const c = campus.data;
  const mapUrl = externalMapUrl(c);
  const members = buildings.filter((b) => c.buildings.some((pl) => pl.buildingId === b.id));

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? '').trim();
    setBusy(true);
    setError(null);
    try {
      await api.campuses.save({
        ...campusDoc(c),
        name: text('name'),
        code: text('code') || undefined,
        address: text('address') || undefined,
        geo: parseGeo(text('lat'), text('lng')),
      });
      await invalidateStructure(queryClient);
      setEditing(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Xoá cơ sở "${c.name}"?`)) return;
    setError(null);
    try {
      await api.campuses.remove(c.id);
      await invalidateStructure(queryClient);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <section className="card campus-card">
      <div className="card-header">
        <div>
          <h2>
            {c.name} {c.code && <span className="muted">({c.code})</span>}
          </h2>
          <p className="muted small">
            {c.address ?? 'Chưa có địa chỉ'}
            {c.geo && ` · GPS ${c.geo.lat}, ${c.geo.lng}`}
            {mapUrl && (
              <>
                {' · '}
                <a href={mapUrl} target="_blank" rel="noreferrer">
                  Xem trên bản đồ
                </a>
              </>
            )}
          </p>
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!c.buildings.length}
            title="Vẽ đường, dốc, cổng… và đặt các toà — chung một chỗ với bản đồ trong toà"
            onClick={() => {
              const first = c.buildings[0];
              if (first) openMap(navigate, first.buildingId, 'site');
            }}
          >
            Vẽ trên bản đồ
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setEditing(!editing)}>
            {editing ? 'Đóng' : 'Sửa thông tin'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            disabled={c.buildings.length > 0}
            title={c.buildings.length ? 'Chuyển hoặc xoá các toà nhà trước' : undefined}
            onClick={() => void remove()}
          >
            Xoá
          </button>
        </div>
      </div>

      {editing && (
        <form className="campus-form" onSubmit={(e) => void save(e)}>
          <label className="field">
            <span>Tên cơ sở</span>
            <input name="name" defaultValue={c.name} required />
          </label>
          <label className="field">
            <span>Mã</span>
            <input name="code" defaultValue={c.code ?? ''} placeholder="vd. CS1" />
          </label>
          <label className="field campus-form-wide">
            <span>Địa chỉ</span>
            <input name="address" defaultValue={c.address ?? ''} />
          </label>
          <label className="field">
            <span>Vĩ độ (lat)</span>
            <input name="lat" inputMode="decimal" defaultValue={c.geo?.lat ?? ''} />
          </label>
          <label className="field">
            <span>Kinh độ (lng)</span>
            <input name="lng" inputMode="decimal" defaultValue={c.geo?.lng ?? ''} />
          </label>
          <div className="btn-row campus-form-wide">
            <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>
              Lưu thông tin
            </button>
          </div>
        </form>
      )}
      {error && <p className="error small">{error}</p>}

      <div className="campus-body">
        <div className="campus-preview">
          {c.buildings.length ? (
            <SiteMap buildings={siteBuildingsOf(c)} />
          ) : (
            <p className="muted center">Chưa có toà nhà</p>
          )}
        </div>
        <ul className="campus-buildings">
          {members.map((b) => (
            <BuildingRow key={b.id} building={b} campusId={c.id} onError={setError} />
          ))}
          {!members.length && (
            <li className="muted small">
              Thêm toà bằng ô "Toà nhà" trên thanh trên cùng, hoặc chuyển toà từ cơ sở khác.
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

export function CampusesPage() {
  const queryClient = useQueryClient();
  const campuses = useCampuses();
  const buildings = useBuildings();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    try {
      await api.campuses.create({
        name: String(f.get('name') ?? '').trim(),
        address: String(f.get('address') ?? '').trim() || undefined,
      });
      await invalidateStructure(queryClient);
      setAdding(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (campuses.isPending || buildings.isPending) return <p className="muted">Đang tải…</p>;
  if (campuses.isError) return <p className="error">{errorMessage(campuses.error)}</p>;
  const all = buildings.data ?? [];
  const unassigned = all.filter((b) => !b.campusId);

  return (
    <div className="stack">
      <div className="page-header">
        <h1>Quản lý cơ sở</h1>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(!adding)}>
          + Thêm cơ sở
        </button>
      </div>
      <p className="muted">
        Mỗi cơ sở gồm một hoặc nhiều toà nhà đặt trên cùng một mặt bằng tổng thể. Mỗi toà chỉ thuộc
        một cơ sở. Đường, dốc, cổng, vị trí các toà… vẽ ngay trên trang Bản đồ (lớp "Ngoài trời").
      </p>

      {adding && (
        <form className="card campus-form" onSubmit={(e) => void create(e)}>
          <label className="field">
            <span>Tên cơ sở</span>
            <input name="name" required autoFocus placeholder="vd. Cơ sở 2 – Thủ Đức" />
          </label>
          <label className="field campus-form-wide">
            <span>Địa chỉ</span>
            <input name="address" />
          </label>
          <div className="btn-row campus-form-wide">
            <button type="submit" className="btn btn-sm btn-primary">
              Tạo cơ sở
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setAdding(false)}>
              Huỷ
            </button>
          </div>
        </form>
      )}
      {error && <p className="error">{error}</p>}

      {campuses.data.map((c) => (
        <CampusCard key={c.id} campusId={c.id} buildings={all} />
      ))}

      {unassigned.length > 0 && (
        <section className="card">
          <h2>Chưa thuộc cơ sở nào</h2>
          <ul className="campus-buildings">
            {unassigned.map((b) => (
              <BuildingRow key={b.id} building={b} onError={setError} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
