import { lazy, Suspense, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { campusViewSite, externalMapUrl, type SitePoi } from '@hwn/map-core';
import { CampusViewer, SITE_POI_STYLE } from '@hwn/map-render';
import { Icon } from '../components/Icon';
import { api, errorMessage } from '../lib/api';
import { siteLocation } from '../lib/campus';
import {
  queryKeys,
  useActiveBuilding,
  useActiveBuildingId,
  useCampusIdOf,
  useCampusMap,
} from '../lib/queries';

// three.js chỉ tải khi bấm 3D.
const Campus3D = lazy(() => import('@hwn/map-render/3d').then((m) => ({ default: m.Campus3D })));
import { useNav } from '../lib/store';

/**
 * Bản đồ cả khuôn viên theo tầng: tầng đang chọn của mọi toà + đường xe, lối đi bộ, bãi xe, cổng,
 * điểm ngoài trời. Chạm vào toà để mở toà đó, chạm vào điểm để xem và chỉ đường tới.
 * `?poi=<id>` mở sẵn một điểm.
 */
export function CampusPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const building = useActiveBuilding();
  const campusId = useCampusIdOf(building.data?.id);
  const [level, setLevel] = useState<number | null>(null);
  const map = useCampusMap(campusId, level);
  const location = useNav((s) => s.location);
  const setBuildingId = useActiveBuildingId((s) => s.setBuildingId);

  const poiParam = params.get('poi');
  const [picked, setPicked] = useState<SitePoi | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const fromParam = dismissed ? null : map.data?.campus.site?.pois.find((p) => p.id === poiParam);
  const poi = picked ?? fromParam ?? null;

  const campus = map.data?.campus;
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  // Dữ liệu đầy đủ các toà cho chế độ 3D (cùng cache với các trang khác).
  const fulls = useQueries({
    queries: (mode === '3d' ? (campus?.buildings ?? []) : []).map((pl) => ({
      queryKey: queryKeys.building(pl.buildingId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.buildings.get(pl.buildingId, { signal }),
      staleTime: 5 * 60_000,
    })),
  });
  const here = siteLocation(location, campus, building.data);
  const mapUrl = campus && externalMapUrl(campus);
  const canRoute = !!here;

  return (
    <main className="screen">
      <header className="screen-header">
        <Link to="/" className="back-link">
          <Icon name="back" size={18} /> Trang chủ
        </Link>
        <h1>{campus?.name ?? 'Bản đồ khuôn viên'}</h1>
        {campus?.address && (
          <p className="muted small">
            {campus.address}
            {mapUrl && (
              <>
                {' · '}
                <a href={mapUrl} target="_blank" rel="noreferrer">
                  Mở bản đồ ngoài
                </a>
              </>
            )}
          </p>
        )}
      </header>

      {building.isSuccess && !campusId && (
        <p className="muted page">Toà nhà này chưa thuộc cơ sở nào.</p>
      )}
      {map.isError && <p className="error page">{errorMessage(map.error)}</p>}

      {map.data && campus && (
        <div className="screen-map">
          <div className="hwn-map-viewer campus-mode-switch">
            <div className="hwn-map-toolbar">
              <div className="hwn-map-segmented" role="group" aria-label="Chế độ xem">
                {(['2d', '3d'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={mode === m ? 'active' : ''}
                    aria-pressed={mode === m}
                    onClick={() => setMode(m)}
                  >
                    {m.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {mode === '3d' ? (
            <Suspense fallback={<p className="muted center-text">Đang tải 3D…</p>}>
              <Campus3D
                buildings={campus.buildings.flatMap((pl) => {
                  const info = campus.buildingInfo.find((i) => i.id === pl.buildingId);
                  const full = fulls.find((q) => q.data?.id === pl.buildingId)?.data;
                  return info
                    ? [
                        {
                          placement: pl,
                          id: pl.buildingId,
                          name: info.name,
                          footprint: info.footprint,
                          floors: full?.floors,
                        },
                      ]
                    : [];
                })}
                site={campusViewSite(campus)}
                departments={map.data.departments}
                level={map.data.level}
                focusBuildingId={building.data?.id}
                onBuildingClick={(id) => {
                  setBuildingId(id);
                  navigate('/');
                }}
              />
            </Suspense>
          ) : (
            <CampusViewer
              data={map.data}
              onLevelChange={setLevel}
              location={here}
              selectedBuildingId={building.data?.id}
              highlightPoiId={poi?.id}
              onBuildingClick={(id) => {
                setBuildingId(id);
                navigate('/');
              }}
              onPoiClick={setPicked}
            />
          )}
          {poi && (
            <div className="place-card" role="dialog" aria-label={poi.name}>
              <div className="place-card-head">
                <span
                  className="landmark-icon"
                  style={{ background: SITE_POI_STYLE[poi.kind].color, width: 28, height: 28 }}
                  aria-hidden
                />
                <div>
                  <strong>{poi.name}</strong>
                  <p className="muted small">
                    {SITE_POI_STYLE[poi.kind].label} · ngoài trời
                    {poi.description ? ` · ${poi.description}` : ''}
                  </p>
                </div>
              </div>
              <div className="button-row">
                {canRoute ? (
                  <Link
                    to={`/campus-route?poi=${encodeURIComponent(poi.id)}`}
                    className="button button-primary"
                  >
                    <Icon name="walk" size={18} /> Chỉ đường tới đây
                  </Link>
                ) : (
                  <Link
                    to={`/locate?returnTo=${encodeURIComponent(`/campus-route?poi=${poi.id}`)}`}
                    className="button button-primary"
                  >
                    <Icon name="camera" size={18} /> Xác định vị trí để chỉ đường
                  </Link>
                )}
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setPicked(null);
                    setDismissed(true);
                  }}
                >
                  Đóng
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
