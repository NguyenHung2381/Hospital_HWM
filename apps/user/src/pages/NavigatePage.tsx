import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { RouteRequest } from '@hwn/api-client';
import { compassToHeading, type Id } from '@hwn/map-core';
import {
  MapViewer,
  positionOnTrack,
  routeStepGeometry,
  routeTrack,
  type MapLocation,
} from '@hwn/map-render';
import { Icon } from '../components/Icon';
import { NeedLocationLinks } from '../components/LocationCard';
import { PlaceCard, type Place } from '../components/PlaceCard';
import { StepSheet, type NavMode } from '../components/StepSheet';
import { errorMessage } from '../lib/api';
import { requestOrientationPermission, useCompass } from '../lib/compass';
import { describeLocation, locationText } from '../lib/location';
import { atSegmentEnd, progressAtStep, walk, type NavProgress } from '../lib/navProgress';
import { requestMotionPermission, STRIDE_METERS, usePedometer } from '../lib/pedometer';
import { useActiveBuilding, useCampusContext, useRoute } from '../lib/queries';
import { isStale, useNav } from '../lib/store';
import { resolveTarget } from '../lib/target';

const START: NavProgress = { step: 0, segmentIndex: 0, distance: 0 };
/** Tốc độ người đi ảo khi mô phỏng (m/s) — nhanh hơn đi bộ thật (~1.2 m/s) để xem cho nhanh. */
const DEMO_SPEED = 3.5;
const DEMO_TICK_MS = 250;
/** Dừng ở cửa thang trước khi sang tầng mới (ms). */
const DEMO_HOLD_MS = 1200;

export function NavigatePage() {
  const { targetId = '' } = useParams();
  const building = useActiveBuilding();
  const location = useNav((s) => s.location);
  const accessibleOnly = useNav((s) => s.accessibleOnly);
  const setAccessibleOnly = useNav((s) => s.setAccessibleOnly);

  const b = building.data;
  const campus = useCampusContext(b);
  const from = b && location?.buildingId === b.id ? location : null;
  const target = useMemo(() => (b ? resolveTarget(b, targetId) : undefined), [b, targetId]);
  const request = useMemo<RouteRequest | null>(
    () =>
      b && from && target
        ? {
            buildingId: b.id,
            from: { floorId: from.floorId, position: from.position },
            to: target.to,
            accessibleOnly,
          }
        : null,
    [b, from, target, accessibleOnly],
  );
  const route = useRoute(request);

  const steps = useMemo(() => (route.data ? routeStepGeometry(route.data) : []), [route.data]);
  const track = useMemo(() => (route.data ? routeTrack(route.data) : []), [route.data]);

  // Vị trí trên tuyến + bước đang xem; về đầu tuyến mỗi khi có tuyến mới.
  const [progress, setProgress] = useState<NavProgress>(START);
  const [progressFor, setProgressFor] = useState(route.data);
  // Tầng người dùng tự chọn xem (ghi đè tầng của bước hiện tại cho tới khi đổi bước).
  const [floorOverride, setFloorOverride] = useState<Id | null>(null);
  const [mode, setMode] = useState<NavMode>('browse');
  const [stepCount, setStepCount] = useState(0);
  if (progressFor !== route.data) {
    setProgressFor(route.data);
    setProgress(START);
    setFloorOverride(null);
  }
  const step = progress.step;
  const goToStep = (i: number) => {
    setProgress(progressAtStep(steps, i));
    setFloorOverride(null);
  };

  const changeMode = async (next: NavMode) => {
    setFloorOverride(null);
    if (next === 'demo' && step >= steps.length - 1) setProgress(START);
    if (next === 'follow') {
      setStepCount(0);
      // iOS chỉ cho xin quyền cảm biến ngay trong thao tác chạm.
      await requestMotionPermission();
    }
    setMode(next);
  };

  // Theo bước chân: mỗi bước đếm được đẩy vị trí đi tiếp dọc tuyến.
  const pedometer = usePedometer(mode === 'follow' && steps.length > 0, () => {
    setStepCount((c) => c + 1);
    setProgress((p) => walk(p, STRIDE_METERS, steps, track));
  });

  const holdSince = useRef<number | null>(null);
  // Mô phỏng: một người đi ảo đi hết tuyến, dừng một nhịp ở mỗi lần đổi tầng.
  const demoTick = useEffectEvent(() => {
    if (!atSegmentEnd(progress, track)) {
      setProgress(walk(progress, (DEMO_SPEED * DEMO_TICK_MS) / 1000, steps, track));
      return;
    }
    const nextSeg = steps.findIndex((s) => s.segmentIndex === progress.segmentIndex + 1);
    if (nextSeg < 0) {
      setProgress({ ...progress, step: steps.length - 1 });
      setMode('browse');
    } else if (performance.now() - (holdSince.current ?? performance.now()) > DEMO_HOLD_MS) {
      holdSince.current = null;
      setProgress(progressAtStep(steps, nextSeg));
    } else {
      holdSince.current ??= performance.now();
    }
  });
  useEffect(() => {
    if (mode !== 'demo') return;
    holdSince.current = null;
    const id = window.setInterval(demoTick, DEMO_TICK_MS);
    return () => window.clearInterval(id);
  }, [mode]);

  // Giữ màn hình sáng khi đang đi theo hướng dẫn.
  useEffect(() => {
    if (mode === 'browse' || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let released = false;
    navigator.wakeLock
      .request('screen')
      .then((l) => {
        if (released) void l.release();
        else lock = l;
      })
      .catch(() => {});
    return () => {
      released = true;
      void lock?.release();
    };
  }, [mode]);

  const relocateHref = `/locate?returnTo=${encodeURIComponent(`/navigate/${targetId}`)}`;
  const geo = steps[step];
  const floorName = (id: Id) => b?.floors.find((f) => f.id === id)?.name ?? id;
  // Khi đang đi (mô phỏng / bước chân), chấm vị trí chạy dọc tuyến thay vì đứng ở điểm xuất phát.
  const moving = mode !== 'browse';
  const onTrack = moving ? positionOnTrack(track, progress.segmentIndex, progress.distance) : null;
  // La bàn: hướng điện thoại (đổi sang hướng trên mặt bằng theo góc Bắc của toà nhà) quyết định
  // hướng của chấm vị trí, và bản đồ xoay để hướng đó luôn ở phía trên màn hình.
  const [compassOn, setCompassOn] = useState(false);
  const compass = useCompass(compassOn);
  const facing = b && compass.heading !== null ? compassToHeading(b, compass.heading) : null;
  const toggleCompass = async () => {
    if (!compassOn) await requestOrientationPermission();
    setCompassOn((v) => !v);
  };
  const mapLocation: MapLocation | null = onTrack
    ? { floorId: onTrack.floorId, position: onTrack.point, heading: facing ?? onTrack.heading }
    : from && (facing !== null ? { ...from, heading: facing } : from);
  const rotation = facing !== null ? -90 - facing : 0;

  // Chạm vào phòng / ghim / mốc trên bản đồ: hiện thẻ thông tin kèm nút chỉ đường tới đó.
  const [picked, setPicked] = useState<{ place: Place; floorId: Id } | null>(null);
  const [pickedFor, setPickedFor] = useState(targetId);
  if (pickedFor !== targetId) {
    setPickedFor(targetId);
    setPicked(null);
  }
  const pickedFloor = picked && b?.floors.find((f) => f.id === picked.floorId);
  const activeStep = useMemo(() => geo && { ...geo, walker: !moving }, [geo, moving]);

  return (
    <main className="screen">
      <header className="screen-header">
        <Link to="/" className="back-link">
          <Icon name="back" size={18} /> Trang chủ
        </Link>
        <h1>{target ? target.name : 'Chỉ đường'}</h1>
        {target && (
          <p className="muted small">
            {[target.detail, target.floor.name].filter(Boolean).join(' · ')}
            {from && b && ` · từ ${locationText(describeLocation(b, from))}`}
          </p>
        )}
        {compass.status === 'unavailable' && (
          <p className="warn small">
            Thiết bị không có la bàn hoặc chưa cho phép dùng cảm biến hướng.
          </p>
        )}
        {from && isStale(from) && (
          <p className="warn small">
            Vị trí xuất phát đã cũ. <Link to={relocateHref}>Chụp lại</Link> để có đường chính xác.
          </p>
        )}
      </header>

      {building.isError && <p className="error">{errorMessage(building.error)}</p>}
      {b && !target && <p className="error page">Không tìm thấy điểm đến này.</p>}

      {b && target && !from && (
        <section className="card need-location">
          <h2>Bạn đang ở đâu?</h2>
          <p className="muted">Cần biết vị trí hiện tại để chỉ đường tới {target.name}.</p>
          <Link to={relocateHref} className="button button-primary button-block">
            <Icon name="camera" /> Chụp ảnh xác định vị trí
          </Link>
          <NeedLocationLinks building={b} returnTo={`/navigate/${targetId}`} />
        </section>
      )}

      {b && target && from && (
        <>
          <div className="screen-map">
            <MapViewer
              building={b}
              campus={campus}
              route={route.data}
              location={mapLocation}
              smoothLocation={moving}
              routeProgress={progress}
              activeStep={activeStep}
              highlightRoomId={target.kind === 'room' ? target.id : null}
              highlightLandmarkId={target.kind === 'landmark' ? target.id : null}
              rotation={rotation}
              compassActive={compassOn}
              onCompassClick={() => void toggleCompass()}
              onRoomClick={(room) => {
                const floor = b.floors.find((f) => f.rooms.some((r) => r.id === room.id));
                if (floor) setPicked({ place: { kind: 'room', room }, floorId: floor.id });
              }}
              onLandmarkClick={(landmark) => {
                const floor = b.floors.find((f) => f.landmarks?.some((l) => l.id === landmark.id));
                if (floor) setPicked({ place: { kind: 'landmark', landmark }, floorId: floor.id });
              }}
              floorId={floorOverride ?? geo?.floorId ?? from.floorId}
              onFloorChange={setFloorOverride}
            />
            {picked && pickedFloor && (
              <PlaceCard
                building={b}
                floor={pickedFloor}
                place={picked.place}
                currentTargetId={targetId}
                onClose={() => setPicked(null)}
              />
            )}
          </div>
          {route.isLoading && <p className="sheet muted center-text">Đang tìm đường…</p>}
          {route.isError && (
            <section className="sheet">
              <p className="error">{errorMessage(route.error)}</p>
              {accessibleOnly && (
                <button
                  type="button"
                  className="button button-block"
                  onClick={() => setAccessibleOnly(false)}
                >
                  Thử cả lối có cầu thang
                </button>
              )}
              <Link to={relocateHref} className="button button-block">
                <Icon name="camera" size={18} /> Chụp lại vị trí
              </Link>
            </section>
          )}
          {route.data && (
            <StepSheet
              route={route.data}
              steps={steps}
              step={step}
              walked={progress.distance}
              onStep={goToStep}
              mode={mode}
              onModeChange={(m) => void changeMode(m)}
              pedometer={pedometer}
              stepCount={stepCount}
              floorName={floorName}
              accessibleOnly={accessibleOnly}
              onAccessibleChange={setAccessibleOnly}
              relocateHref={relocateHref}
            />
          )}
        </>
      )}
    </main>
  );
}
