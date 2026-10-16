/**
 * Cảnh 3D cả cơ sở bệnh viện: mọi toà đặt đúng vị trí / góc xoay trên mặt bằng tổng thể, các tầng
 * xếp theo cao độ thật, cùng phần ngoài trời (đường, dốc nghiêng lên sảnh kèm lối đi bộ, bãi xe,
 * mái che, hàng rào, cổng). Tầng chung `level` là tầng "cắt": hiện nội thất (tường thấp), các tầng
 * phía trên vẽ mờ để nhìn xuyên vào.
 */
import { useEffect, useMemo, type CSSProperties } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import {
  boundsOf,
  campusLevel,
  footprintCenter,
  placedFootprint,
  type BuildingPlacement,
  type Department,
  type Floor,
  type Id,
  type Point,
  type Room,
  type Route,
  type SitePlan,
} from '@hwn/map-core';
import { useMapTheme, type ThemeSetting } from '../core/hooks';
import { withAlpha, type MapTheme } from '../core/theme';
import { mergeBounds } from '../core/viewport';
import {
  rampLabel,
  rampStyle,
  SITE_AREA_STYLE,
  SITE_RAMP_USE_STYLE,
  VEHICLE_ACCESS_STYLE,
} from '../two-d/siteLayers';
import type { MapLocation } from '../types';
import { FitCamera, FloorMesh, Route3D, TextLabel } from './Building3D';
import { prism, toVec3, type Vec3 } from './geometry';
import { buildSiteMeshes, disposeSiteMeshes, PLINTH } from './site3d';
import { stairLayouts } from './stairs';

export interface Campus3DBuilding {
  placement: BuildingPlacement;
  id: Id;
  name: string;
  /** Đường bao (hệ trục của toà) — dùng khi chưa có dữ liệu tầng. */
  footprint: readonly Point[];
  /** Các tầng (đã tải). Bỏ trống = vẽ khối đặc theo đường bao. */
  floors?: readonly Floor[];
}

/** Cầu nối giữa hai toà (toạ độ mặt bằng tổng thể; cao độ tính từ sàn tầng trệt). */
export interface Campus3DLink {
  id: Id;
  name: string;
  kind: 'bridge' | 'tunnel' | 'corridor';
  from: Point;
  to: Point;
  /** Cao độ sàn cầu (m) — cùng hệ với `Floor.elevation`. */
  elevation: number;
  /** Chiều cao thông thuỷ (m). */
  height: number;
  /** Bề rộng sàn cầu (m). */
  width: number;
  covered: boolean;
}

export interface Campus3DProps {
  buildings: readonly Campus3DBuilding[];
  site?: SitePlan;
  /** Cầu nối / hành lang nối các toà. */
  links?: readonly Campus3DLink[];
  /** Cầu đang chọn (vẽ nổi bật). */
  selectedLinkId?: Id | null;
  departments?: readonly Department[];
  /** Tầng chung đang xem (tầng "cắt"). Bỏ trống = tầng thấp nhất của toà trọng tâm. */
  level?: number;
  /** Toà đang xem: tuyến đường / vị trí / phòng nổi bật theo hệ trục của toà này. */
  focusBuildingId?: Id | null;
  route?: Route | null;
  location?: MapLocation | null;
  highlightRoomId?: Id | null;
  destinationLabel?: string;
  onRoomClick?: (room: Room) => void;
  onBuildingClick?: (buildingId: Id) => void;
  theme?: ThemeSetting;
  className?: string;
  style?: CSSProperties;
}

/** Tường các tầng dưới tầng cắt cao đủ, tầng cắt thấp xuống để nhìn vào trong phòng. */
const CUT_WALL_SCALE = 0.45;

export function Campus3D({
  buildings,
  site,
  links = [],
  selectedLinkId,
  departments = [],
  level,
  focusBuildingId,
  route,
  location,
  highlightRoomId,
  destinationLabel,
  onRoomClick,
  onBuildingClick,
  theme: themeSetting,
  className,
  style,
}: Campus3DProps) {
  const theme = useMapTheme(themeSetting);

  /**
   * Đường bao các toà trên mặt bằng tổng thể, so theo nội dung (danh sách toà thường được dựng lại
   * mỗi lần vẽ) để không phải dựng lại phần ngoài trời.
   */
  const footprintKey = JSON.stringify(
    buildings.map((b) => placedFootprint(b.placement, b.footprint)),
  );
  const siteMeshes = useMemo(
    () =>
      site
        ? buildSiteMeshes(
            site,
            {
              // Bãi xe cùng mặt nhựa với đường như bản đồ 2D.
              area: (k) =>
                k === 'parking' || k === 'bike_parking' ? '#6b7280' : SITE_AREA_STYLE[k].fill,
              edge: (p) =>
                p.kind === 'ramp' || p.use
                  ? rampStyle(p.use).color
                  : p.vehicles
                    ? VEHICLE_ACCESS_STYLE[p.vehicles].color
                    : null,
              rampLabel: (p) => (p.use ? `Dốc ${SITE_RAMP_USE_STYLE[p.use].label}` : rampLabel(p)),
            },
            JSON.parse(footprintKey) as Point[][],
          )
        : null,
    [site, footprintKey],
  );
  useEffect(
    () => () => {
      if (siteMeshes) disposeSiteMeshes(siteMeshes);
    },
    [siteMeshes],
  );

  const focus = buildings.find((b) => b.id === focusBuildingId);
  const cut =
    level ??
    (focus?.floors?.length
      ? campusLevel(focus.placement, Math.min(...focus.floors.map((f) => f.level)))
      : 1);

  const frame = useMemo(() => {
    const b = mergeBounds([
      boundsOf(buildings.flatMap((x) => placedFootprint(x.placement, x.footprint))),
      site
        ? boundsOf([
            ...site.areas.flatMap((a) => a.polygon),
            ...site.paths.flatMap((p) => p.points),
          ])
        : null,
    ]) ?? { minX: 0, minY: 0, maxX: 50, maxY: 50 };
    return {
      bounds: b,
      center: [(b.minX + b.maxX) / 2, 4, (b.minY + b.maxY) / 2] as Vec3,
      // Khuôn viên dẹt: thu hẹp khối cầu bao để cảnh lấp đầy khung hình.
      radius: (Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2) * 0.62,
    };
  }, [buildings, site]);
  const size = Math.max(
    frame.bounds.maxX - frame.bounds.minX,
    frame.bounds.maxY - frame.bounds.minY,
  );

  const ground = useMemo(
    () => new THREE.Color(theme.background).lerp(new THREE.Color(theme.wall), 0.1).getStyle(),
    [theme.background, theme.wall],
  );

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: theme.background,
        ...style,
      }}
    >
      <Canvas frameloop="demand" dpr={[1, 2]} camera={{ fov: 45, near: 0.5, far: 4000 }}>
        <hemisphereLight args={['#ffffff', '#94a3b8', 1.1]} />
        <directionalLight position={[size * 0.4, size, size * 0.3]} intensity={1.3} />
        {/* Mặt đất. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[frame.center[0], -0.02, frame.center[2]]}>
          <planeGeometry args={[size * 1.6 + 40, size * 1.6 + 40]} />
          <meshStandardMaterial color={ground} />
        </mesh>
        {siteMeshes && <Site3D meshes={siteMeshes} />}
        {links.map((l) => (
          <Link3D key={l.id} link={l} selected={l.id === selectedLinkId} theme={theme} />
        ))}
        {buildings.map((b) => (
          <PlacedBuilding3D
            key={b.id}
            building={b}
            cut={cut}
            departments={departments}
            theme={theme}
            focused={b.id === focusBuildingId}
            route={b.id === focusBuildingId ? route : null}
            location={b.id === focusBuildingId ? location : null}
            highlightRoomId={b.id === focusBuildingId ? highlightRoomId : null}
            destinationLabel={destinationLabel}
            onRoomClick={b.id === focusBuildingId ? onRoomClick : undefined}
            onClick={onBuildingClick ? () => onBuildingClick(b.id) : undefined}
          />
        ))}
        <OrbitControls makeDefault enableDamping maxPolarAngle={Math.PI * 0.47} />
        <FitCamera center={frame.center} radius={frame.radius} fitKey={buildings.length} />
      </Canvas>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Site3D({ meshes }: { meshes: ReturnType<typeof buildSiteMeshes> }) {
  return (
    <group>
      {meshes.areas.map((a, i) => (
        <mesh key={i} geometry={a.geometry}>
          <meshStandardMaterial color={a.color} transparent={a.opacity < 1} opacity={a.opacity} />
        </mesh>
      ))}
      {meshes.plinths && (
        <mesh geometry={meshes.plinths}>
          <meshStandardMaterial color="#d6d3d1" />
        </mesh>
      )}
      {meshes.structures && (
        <mesh geometry={meshes.structures}>
          <meshStandardMaterial color="#cbd5e1" />
        </mesh>
      )}
      {meshes.paving && (
        <mesh geometry={meshes.paving}>
          <meshStandardMaterial color="#d9c6a5" side={THREE.DoubleSide} />
        </mesh>
      )}
      {meshes.edges.map((e, i) => (
        <mesh key={i} geometry={e.geometry}>
          <meshStandardMaterial color={e.color} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {meshes.asphalt && (
        <mesh geometry={meshes.asphalt}>
          <meshStandardMaterial color="#6b7280" side={THREE.DoubleSide} />
        </mesh>
      )}
      {meshes.rampSides && (
        <mesh geometry={meshes.rampSides}>
          <meshStandardMaterial color="#a8a29e" side={THREE.DoubleSide} />
        </mesh>
      )}
      {meshes.roofs && (
        <mesh geometry={meshes.roofs}>
          <meshStandardMaterial
            color="#f59e0b"
            transparent
            opacity={0.45}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      {meshes.posts && (
        <mesh geometry={meshes.posts}>
          <meshStandardMaterial color="#b45309" />
        </mesh>
      )}
      {meshes.fences && (
        <mesh geometry={meshes.fences}>
          <meshStandardMaterial
            color="#64748b"
            transparent
            opacity={0.55}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      {meshes.gates && (
        <mesh geometry={meshes.gates}>
          <meshStandardMaterial color="#334155" />
        </mesh>
      )}
      {meshes.zebras && (
        <mesh geometry={meshes.zebras}>
          <meshStandardMaterial color="#f8fafc" side={THREE.DoubleSide} />
        </mesh>
      )}
      {meshes.rampSigns.map((s, i) => (
        <TextLabel
          key={i}
          position={s.position}
          text={s.text}
          color={s.color}
          textColor="#ffffff"
          depthTest
        />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */

const DECK = 0.3;
const GLASS_COLOR = '#93c5fd';

/** Cầu nối: sàn cầu, lan can / vách kính hai bên và mái (nếu có mái che). */
function Link3D({
  link,
  selected,
  theme,
}: {
  link: Campus3DLink;
  selected: boolean;
  theme: MapTheme;
}) {
  const dx = link.to.x - link.from.x;
  const dy = link.to.y - link.from.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.05) return null;
  const y = PLINTH + link.elevation;
  const mid: Vec3 = [(link.from.x + link.to.x) / 2, y, (link.from.y + link.to.y) / 2];
  // Trục x của khối hộp chạy dọc cầu: xoay quanh trục đứng theo hướng from → to (y canvas = z 3D).
  const angle = -Math.atan2(dy, dx);
  const accent = selected ? '#f97316' : '#8b5cf6';
  const sideH = link.covered ? link.height : 1.1;
  const half = link.width / 2;
  return (
    <group>
      <group position={mid} rotation={[0, angle, 0]}>
        <mesh position={[0, -DECK / 2, 0]}>
          <boxGeometry args={[length, DECK, link.width]} />
          <meshStandardMaterial color={accent} />
        </mesh>
        {[half, -half].map((z) => (
          <mesh key={z} position={[0, sideH / 2, z]}>
            <boxGeometry args={[length, sideH, 0.06]} />
            <meshStandardMaterial
              color={link.covered ? GLASS_COLOR : theme.wall3d}
              transparent
              opacity={link.covered ? 0.35 : 0.6}
              depthWrite={false}
            />
          </mesh>
        ))}
        {link.covered && (
          <mesh position={[0, link.height + 0.1, 0]}>
            <boxGeometry args={[length, 0.2, link.width + 0.3]} />
            <meshStandardMaterial color={accent} transparent opacity={0.85} />
          </mesh>
        )}
      </group>
      <TextLabel
        position={[mid[0], y + (link.covered ? link.height : sideH) + 1, mid[2]]}
        text={link.name}
        color={accent}
        textColor="#ffffff"
      />
    </group>
  );
}

/* ------------------------------------------------------------------ */

function PlacedBuilding3D({
  building,
  cut,
  departments,
  theme,
  focused,
  route,
  location,
  highlightRoomId,
  destinationLabel,
  onRoomClick,
  onClick,
}: {
  building: Campus3DBuilding;
  cut: number;
  departments: readonly Department[];
  theme: MapTheme;
  focused: boolean;
  route?: Route | null;
  location?: MapLocation | null;
  highlightRoomId?: Id | null;
  destinationLabel?: string;
  onRoomClick?: (room: Room) => void;
  onClick?: () => void;
}) {
  const { placement } = building;
  const floors = useMemo(
    () => [...(building.floors ?? [])].sort((a, b) => a.level - b.level),
    [building.floors],
  );
  const stairs = useMemo(() => stairLayouts(floors), [floors]);
  const floorY = useMemo(() => new Map(floors.map((f) => [f.id, f.elevation])), [floors]);
  const mass = useMemo(
    () => (floors.length || building.footprint.length < 3 ? null : prism(building.footprint, 0, 7)),
    [floors.length, building.footprint],
  );
  useEffect(() => () => mass?.dispose(), [mass]);

  const visible = floors.filter((f) => campusLevel(placement, f.level) <= cut);
  const cutFloor = visible[visible.length - 1];
  const top = floors.length ? Math.max(...floors.map((f) => f.elevation + f.height)) : 7;
  const center = footprintCenter(building.footprint);
  const outline = useMemo(
    () => building.footprint.map((p) => toVec3(p, 0.06)),
    [building.footprint],
  );

  return (
    <group
      position={[placement.position.x, PLINTH, placement.position.y]}
      rotation={[0, (-placement.rotation * Math.PI) / 180, 0]}
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation();
              onClick();
            }
          : undefined
      }
    >
      {floors.map((f) => {
        const lvl = campusLevel(placement, f.level);
        const isCut = f === cutFloor;
        return (
          <FloorMesh
            key={f.id}
            floor={f}
            y={f.elevation}
            ghost={lvl > cut}
            departments={departments}
            theme={theme}
            highlightRoomId={isCut ? highlightRoomId : null}
            wallHeightScale={isCut ? CUT_WALL_SCALE : 1}
            stairs={stairs}
            onRoomClick={isCut ? onRoomClick : undefined}
          />
        );
      })}
      {mass && (
        <mesh geometry={mass}>
          <meshStandardMaterial color={theme.wall3d} transparent opacity={0.85} />
        </mesh>
      )}
      {focused && outline.length >= 3 && (
        <Line points={[...outline, outline[0]!]} color={theme.route} lineWidth={3} />
      )}
      {route && (
        <Route3D
          route={route}
          floors={floors}
          floorY={floorY}
          stairs={stairs}
          wallHeightScale={CUT_WALL_SCALE}
          theme={theme}
          destinationLabel={destinationLabel}
        />
      )}
      {location && floorY.has(location.floorId) && (
        <mesh position={toVec3(location.position, floorY.get(location.floorId)! + 0.4)}>
          <sphereGeometry args={[0.4, 24, 16]} />
          <meshStandardMaterial color={theme.location} />
          <TextLabel position={[0, 0.8, 0]} text="Bạn ở đây" color={theme.location} />
        </mesh>
      )}
      <TextLabel
        position={[center.x, top + 1.5, center.y]}
        text={building.name}
        color={focused ? theme.route : withAlpha(theme.wall, 0.9)}
        textColor={focused ? '#ffffff' : theme.background}
      />
    </group>
  );
}
