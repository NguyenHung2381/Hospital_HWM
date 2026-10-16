import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import type { CampusRouteRequest } from '@hwn/api-client';
import { levelOfFloorId, type CampusLeg, type CampusStepType } from '@hwn/map-core';
import { CampusViewer } from '@hwn/map-render';
import { Icon, type IconName } from '../components/Icon';
import { NeedLocationLinks } from '../components/LocationCard';
import { errorMessage } from '../lib/api';
import { formatMinutes, siteLocation } from '../lib/campus';
import {
  useActiveBuilding,
  useActiveBuildingId,
  useBuilding,
  useBuildings,
  useCampusMap,
  useCampusRoute,
} from '../lib/queries';
import { useNav } from '../lib/store';
import { resolveTarget } from '../lib/target';

const STEP_ICON: Partial<Record<CampusStepType, IconName>> = {
  start: 'start',
  straight: 'straight',
  'turn-left': 'left',
  'turn-right': 'right',
  'take-elevator': 'elevator',
  'take-stairs': 'stairs',
  'take-escalator': 'escalator',
  'enter-room': 'door',
  'exit-building': 'door',
  'enter-building': 'door',
  'take-link': 'walk',
  arrive: 'flag',
};

/**
 * Chỉ đường liên toà trong cùng cơ sở: `?to=<phòng|mốc>&tb=<toà đích>` hoặc `?poi=<điểm ngoài trời>`.
 * Bản đồ hiện cả khuôn viên ở tầng của bước đang xem; khi đã tới toà đích có thể chuyển sang chỉ
 * đường chi tiết trong toà.
 */
export function CampusRoutePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const toId = params.get('to');
  const targetBuildingId = params.get('tb') ?? undefined;
  const poiId = params.get('poi');

  const active = useActiveBuilding();
  const buildings = useBuildings();
  const location = useNav((s) => s.location);
  const accessibleOnly = useNav((s) => s.accessibleOnly);
  const setAccessibleOnly = useNav((s) => s.setAccessibleOnly);
  const setLocation = useNav((s) => s.setLocation);
  const setBuildingId = useActiveBuildingId((s) => s.setBuildingId);
  const [preferCovered, setPreferCovered] = useState(false);

  const campusOf = (id: string | undefined) => buildings.data?.find((b) => b.id === id)?.campusId;
  const fromBuilding = useBuilding(location?.buildingId);
  const targetBuilding = useBuilding(targetBuildingId);
  const target = targetBuilding.data && toId ? resolveTarget(targetBuilding.data, toId) : undefined;
  const campusId = campusOf(location?.buildingId);
  const sameCampus = !!campusId && (poiId ? true : campusOf(targetBuildingId) === campusId);

  const request = useMemo<CampusRouteRequest | null>(() => {
    if (!location || !campusId || !sameCampus) return null;
    const to = poiId
      ? { poiId }
      : target && targetBuildingId
        ? { ...target.to, buildingId: targetBuildingId }
        : null;
    if (!to) return null;
    return {
      campusId,
      from: {
        buildingId: location.buildingId,
        floorId: location.floorId,
        position: location.position,
      },
      to: to as CampusRouteRequest['to'],
      accessibleOnly,
      preferCovered,
    };
  }, [
    location,
    campusId,
    sameCampus,
    poiId,
    target,
    targetBuildingId,
    accessibleOnly,
    preferCovered,
  ]);
  const routeQuery = useCampusRoute(request);
  const result = routeQuery.data;

  const [stepIndex, setStepIndex] = useState(0);
  const [pickedLevel, setPickedLevel] = useState<number | null>(null);
  const stepLevel = result
    ? levelOfFloorId(result.siteRoute.instructions[stepIndex]?.floorId ?? '')
    : null;
  const level = pickedLevel ?? stepLevel;
  const map = useCampusMap(campusId, level);
  const here = siteLocation(location, map.data?.campus, fromBuilding.data);

  const returnTo = `/campus-route?${params.toString()}`;
  const relocate = `/locate?returnTo=${encodeURIComponent(returnTo)}`;

  // Cùng toà thì dùng trang chỉ đường trong toà (đầy đủ chế độ đi theo, la bàn…).
  const legs = result?.route.legs ?? [];
  if (toId && legs.length === 1 && legs[0]!.kind === 'indoor') {
    return <Navigate to={`/navigate/${toId}`} replace />;
  }

  const lastIndoor = [...legs].reverse().find((l) => l.kind === 'indoor') as
    Extract<CampusLeg, { kind: 'indoor' }> | undefined;
  const finalIndoor = legs[legs.length - 1]?.kind === 'indoor' ? lastIndoor : undefined;
  const buildingName = (id: string) => buildings.data?.find((b) => b.id === id)?.name ?? id;

  /** Đã tới toà đích: đặt vị trí tại cửa vào toà rồi chuyển sang chỉ đường trong toà. */
  const continueIndoors = () => {
    if (!finalIndoor || !toId) return;
    setBuildingId(finalIndoor.buildingId);
    setLocation({
      buildingId: finalIndoor.buildingId,
      floorId: finalIndoor.route.from.floorId,
      position: finalIndoor.route.from.position,
      source: 'entrance',
    });
    navigate(`/navigate/${toId}`);
  };

  const legLabel = (l: CampusLeg) =>
    l.kind === 'indoor'
      ? buildingName(l.buildingId)
      : l.kind === 'outdoor'
        ? l.covered
          ? 'Lối có mái che'
          : 'Ngoài trời'
        : l.link.name;

  return (
    <main className="screen">
      <header className="screen-header">
        <Link to="/" className="back-link">
          <Icon name="back" size={18} /> Trang chủ
        </Link>
        <h1>{result?.route.destinationName ?? target?.name ?? 'Chỉ đường liên toà'}</h1>
        {result && (
          <p className="muted small">
            {Math.round(result.route.distance)} m · {formatMinutes(result.route.estimatedSeconds)}
            {targetBuildingId && ` · ${buildingName(targetBuildingId)}`}
          </p>
        )}
      </header>

      {!location || (location && buildings.isSuccess && !sameCampus) ? (
        <section className="card need-location page">
          <h2>Bạn đang ở đâu?</h2>
          <p className="muted">
            {location
              ? 'Vị trí hiện tại không thuộc cùng cơ sở với điểm đến. Hãy xác định lại vị trí.'
              : 'Cần biết vị trí hiện tại để chỉ đường.'}
          </p>
          <Link to={relocate} className="button button-primary button-block">
            <Icon name="camera" /> Chụp ảnh xác định vị trí
          </Link>
          {active.data && <NeedLocationLinks building={active.data} returnTo={returnTo} />}
        </section>
      ) : (
        <>
          {routeQuery.isPending && request && <p className="muted page">Đang tìm đường…</p>}
          {routeQuery.isError && <p className="error page">{errorMessage(routeQuery.error)}</p>}
          {result && (
            <div className="campus-route-summary">
              <ol className="campus-legs" aria-label="Các chặng">
                {legs.map((l, i) => (
                  <li key={i} className={`campus-leg ${l.kind}`}>
                    {legLabel(l)}
                  </li>
                ))}
              </ol>
              <div className="chips">
                <button
                  type="button"
                  className={`chip${accessibleOnly ? ' chip-active' : ''}`}
                  aria-pressed={accessibleOnly}
                  onClick={() => setAccessibleOnly(!accessibleOnly)}
                >
                  <Icon name="wheelchair" size={16} /> Xe lăn
                </button>
                <button
                  type="button"
                  className={`chip${preferCovered ? ' chip-active' : ''}`}
                  aria-pressed={preferCovered}
                  onClick={() => setPreferCovered(!preferCovered)}
                >
                  ☂ Ưu tiên lối có mái che
                </button>
              </div>
            </div>
          )}

          {map.data && (
            <div className="screen-map">
              <CampusViewer
                data={map.data}
                route={result?.siteRoute}
                location={here}
                onLevelChange={setPickedLevel}
                highlightPoiId={poiId}
              />
            </div>
          )}

          {result && (
            <section className="campus-steps-sheet">
              <ol className="campus-steps">
                {result.route.steps.map((s, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className={`campus-step${i === stepIndex ? ' active' : ''}${s.buildingId ? '' : ' outdoor'}`}
                      onClick={() => {
                        setStepIndex(i);
                        setPickedLevel(null);
                      }}
                    >
                      <Icon name={STEP_ICON[s.type] ?? 'straight'} size={18} />
                      <span>{s.text}</span>
                    </button>
                  </li>
                ))}
              </ol>
              {finalIndoor && toId && legs.length > 1 && (
                <button
                  type="button"
                  className="button button-primary button-block"
                  onClick={continueIndoors}
                >
                  <Icon name="door" /> Đã vào {buildingName(finalIndoor.buildingId)} — chỉ đường
                  trong toà
                </button>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
