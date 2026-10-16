import { useEffect, useMemo, type CSSProperties } from 'react';
import * as THREE from 'three';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three/addons/controls/OrbitControls.js';
import {
  sortedFloors,
  type Building,
  type Department,
  type Floor,
  type Id,
  type Room,
  type Route,
} from '@hwn/map-core';
import { useMapTheme, type ThemeSetting } from '../core/hooks';
import { CONNECTOR_LABEL, connectorColor } from '../core/connectors';
import type { MapTheme } from '../core/theme';
import { floorBounds, mergeBounds } from '../core/viewport';
import type { MapLocation } from '../types';
import {
  buildElevatorGeometry,
  buildSlabGeometry,
  buildWallGeometry,
  flatPolygon,
  toVec3,
  type Vec3,
} from './geometry';
import {
  buildStairGeometry,
  disposeStairGeometry,
  flightFor,
  flightPath,
  insideConnector,
  stairLayouts,
  type FlightDirection,
  type StairGeometry,
  type StairLayout,
} from './stairs';

export interface Building3DProps {
  building: Building;
  route?: Route | null;
  location?: MapLocation | null;
  highlightRoomId?: Id | null;
  /** Các tầng hiển thị đầy đủ. Mặc định: tất cả. */
  floorIds?: readonly Id[];
  /** Hiển thị mờ các tầng không nằm trong `floorIds`. */
  showGhostFloors?: boolean;
  /** Khoảng hở thêm giữa các tầng (m) để nhìn được tầng dưới. Mặc định tự tính theo kích thước toà nhà. */
  floorGap?: number;
  /** Tỉ lệ chiều cao tường (< 1 để nhìn vào bên trong phòng). */
  wallHeightScale?: number;
  theme?: ThemeSetting;
  destinationLabel?: string;
  onRoomClick?: (room: Room) => void;
  className?: string;
  style?: CSSProperties;
}

export const ROUTE_LIFT = 0.25;

export function Building3D({
  building,
  route,
  location,
  highlightRoomId,
  floorIds,
  showGhostFloors = true,
  floorGap,
  wallHeightScale = 0.45,
  theme: themeSetting,
  destinationLabel,
  onRoomClick,
  className,
  style,
}: Building3DProps) {
  const theme = useMapTheme(themeSetting);
  const floors = useMemo(() => sortedFloors(building), [building]);
  const bounds = useMemo(
    () => mergeBounds(floors.map(floorBounds)) ?? { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    [floors],
  );
  const size = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 5);
  // Tách các tầng ra đủ xa để tầng trên không che khuất tầng dưới.
  const gap = floorGap ?? Math.max(3, size * 0.25);
  const floorY = useMemo(
    () => new Map(floors.map((f, i) => [f.id, f.elevation + i * gap])),
    [floors, gap],
  );
  const visible = useMemo(() => new Set(floorIds ?? floors.map((f) => f.id)), [floorIds, floors]);
  const stairs = useMemo(() => stairLayouts(floors), [floors]);

  const frame = useMemo(() => {
    const ys = floors.filter((f) => visible.has(f.id)).map((f) => floorY.get(f.id) ?? 0);
    const minY = ys.length ? Math.min(...ys) : 0;
    const maxY = (ys.length ? Math.max(...ys) : 0) + 2;
    const w = bounds.maxX - bounds.minX;
    const d = bounds.maxY - bounds.minY;
    return {
      center: [
        (bounds.minX + bounds.maxX) / 2,
        (minY + maxY) / 2,
        (bounds.minY + bounds.maxY) / 2,
      ] as Vec3,
      radius: Math.hypot(w, d, maxY - minY) / 2,
    };
  }, [floors, floorY, visible, bounds]);

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
      <Canvas frameloop="demand" dpr={[1, 2]} camera={{ fov: 45, near: 0.1, far: 5000 }}>
        <hemisphereLight args={['#ffffff', '#94a3b8', 1.1]} />
        <directionalLight position={[size, size * 2, size * 0.6]} intensity={1.4} />
        {floors.map((floor) =>
          visible.has(floor.id) || showGhostFloors ? (
            <FloorMesh
              key={floor.id}
              floor={floor}
              y={floorY.get(floor.id) ?? 0}
              ghost={!visible.has(floor.id)}
              departments={building.departments}
              theme={theme}
              highlightRoomId={highlightRoomId}
              wallHeightScale={wallHeightScale}
              stairs={stairs}
              label={floors.length > 1 ? floor.name : undefined}
              onRoomClick={onRoomClick}
            />
          ) : null,
        )}
        {route && (
          <Route3D
            route={route}
            floors={floors}
            floorY={floorY}
            stairs={stairs}
            wallHeightScale={wallHeightScale}
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
        <OrbitControls makeDefault enableDamping maxPolarAngle={Math.PI * 0.47} />
        <FitCamera center={frame.center} radius={frame.radius} fitKey={building.id} />
      </Canvas>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const LABEL_FONT_PX = 12;
const LABEL_RES = 3; // vẽ ở độ phân giải gấp 3 để chữ sắc nét

/** Vẽ nhãn dạng "viên thuốc" lên canvas để dùng làm texture. */
function makeLabelTexture(text: string, color: string, textColor: string) {
  const font = `600 ${LABEL_FONT_PX * LABEL_RES}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  const padX = 8 * LABEL_RES;
  const height = (LABEL_FONT_PX + 10) * LABEL_RES;
  const width = Math.ceil(ctx.measureText(text).width) + padX * 2;
  canvas.width = width;
  canvas.height = height;
  ctx.font = font; // đổi kích thước canvas làm mất trạng thái context
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, height / 2);
  ctx.fill();
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2 + LABEL_RES);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: width / height, pxHeight: height / LABEL_RES };
}

/**
 * Nhãn chữ luôn quay về phía camera, giữ nguyên kích thước trên màn hình và không bị che.
 * Dùng sprite thay vì <Html> của drei để không phải tạo React root phụ.
 */
export function TextLabel({
  position,
  text,
  color,
  textColor = '#ffffff',
  anchor = [0.5, 0],
  depthTest = false,
}: {
  position: Vec3;
  text: string;
  color: string;
  textColor?: string;
  /** Điểm neo của nhãn (0..1), mặc định: giữa cạnh dưới. */
  anchor?: [number, number];
  /** Bật để nhãn bị vật phía trước (ví dụ tầng trên) che như vật thể thường. */
  depthTest?: boolean;
}) {
  const label = useMemo(() => makeLabelTexture(text, color, textColor), [text, color, textColor]);
  useEffect(() => () => label.texture.dispose(), [label]);
  const viewportHeight = useThree((s) => s.size.height);
  const fov = useThree((s) => (s.camera instanceof THREE.PerspectiveCamera ? s.camera.fov : 45));
  // Với sizeAttenuation=false, chiều cao trên màn hình = scale * f / 2 * viewportHeight, f = 1/tan(fov/2).
  const f = 1 / Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  const h = label.pxHeight / ((f / 2) * Math.max(viewportHeight, 1));

  return (
    <sprite position={position} scale={[h * label.aspect, h, 1]} center={anchor} renderOrder={10}>
      <spriteMaterial
        map={label.texture}
        sizeAttenuation={false}
        depthTest={depthTest}
        transparent
      />
    </sprite>
  );
}

/** Hướng nhìn mặc định: chếch từ phía trước, phía trên. */
const VIEW_DIRECTION = new THREE.Vector3(0.25, 0.75, 1).normalize();

/** Đặt camera sao cho khối cầu bán kính `radius` quanh `center` nằm vừa khung hình. */
export function FitCamera({
  center,
  radius,
  fitKey,
}: {
  center: Vec3;
  radius: number;
  fitKey: unknown;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const invalidate = useThree((s) => s.invalidate);
  const aspect = useThree((s) => (s.size.height > 0 ? s.size.width / s.size.height : 0));
  const [cx, cy, cz] = center;

  useEffect(() => {
    // Canvas chưa có kích thước — chờ lần đo tiếp theo, tránh đặt camera ở vô cực.
    if (!(aspect > 0) || !(radius > 0)) return;
    const vFov = THREE.MathUtils.degToRad(
      camera instanceof THREE.PerspectiveCamera ? camera.fov : 45,
    );
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    // Khối cầu bao khá rộng so với toà nhà dẹt nên thu hẹp một chút cho đỡ trống — trừ khi
    // khung hình đứng (hẹp ngang): khi đó chiều dài toà nhà là chiều bị giới hạn.
    const fill = aspect < 1 ? 1.05 : 0.85;
    const dist = (radius * fill) / Math.sin(Math.min(vFov, hFov) / 2);
    camera.position.set(
      cx + VIEW_DIRECTION.x * dist,
      cy + VIEW_DIRECTION.y * dist,
      cz + VIEW_DIRECTION.z * dist,
    );
    camera.lookAt(cx, cy, cz);
    if (controls) {
      controls.target.set(cx, cy, cz);
      controls.maxDistance = dist * 3;
      controls.update();
    }
    invalidate();
  }, [camera, controls, invalidate, aspect, cx, cy, cz, radius, fitKey]);

  return null;
}

/* ------------------------------------------------------------------ */

interface FloorMeshProps {
  floor: Floor;
  y: number;
  ghost: boolean;
  departments: readonly Department[];
  theme: MapTheme;
  highlightRoomId?: Id | null;
  wallHeightScale: number;
  stairs: ReadonlyMap<Id, StairLayout>;
  /** Tên tầng, ghi ở góc tấm sàn để phân biệt các tầng khi xếp chồng. */
  label?: string;
  onRoomClick?: (room: Room) => void;
}

export function FloorMesh({
  floor,
  y,
  ghost,
  departments,
  theme,
  highlightRoomId,
  wallHeightScale,
  stairs,
  label,
  onRoomClick,
}: FloorMeshProps) {
  const bounds = useMemo(() => floorBounds(floor), [floor]);
  const wallHeight = floor.height * wallHeightScale;
  const stairLabels = useMemo(
    () => ({
      up: makeLabelTexture('LÊN', theme.background, theme.connectorStroke),
      down: makeLabelTexture('XUỐNG', theme.background, theme.connectorStroke),
    }),
    [theme.background, theme.connectorStroke],
  );
  useEffect(
    () => () => {
      stairLabels.up.texture.dispose();
      stairLabels.down.texture.dispose();
    },
    [stairLabels],
  );

  const geometry = useMemo(() => {
    const layouts = floor.connectors.flatMap((c) => stairs.get(c.id) ?? []);
    const stairGeometry = buildStairGeometry(layouts, wallHeight, {
      up: stairLabels.up.aspect,
      down: stairLabels.down.aspect,
    });
    return {
      slab: buildSlabGeometry(floor, stairGeometry.holes),
      walls: buildWallGeometry(floor, wallHeightScale),
      rooms: floor.rooms.map((room) => ({ room, geometry: flatPolygon(room.polygon, 0.02) })),
      elevators: floor.connectors
        .filter((c) => c.type === 'elevator')
        .map((connector) => ({
          connector,
          geometry: buildElevatorGeometry(connector, wallHeight),
        })),
      stairs: stairGeometry,
    };
  }, [floor, stairs, wallHeight, wallHeightScale, stairLabels]);

  useEffect(
    () => () => {
      geometry.slab?.dispose();
      geometry.walls.solid?.dispose();
      geometry.walls.glass?.dispose();
      for (const r of geometry.rooms) r.geometry.dispose();
      for (const c of geometry.elevators) c.geometry.dispose();
      disposeStairGeometry(geometry.stairs);
    },
    [geometry],
  );

  const colors = useMemo(() => new Map(departments.map((d) => [d.id, d.color])), [departments]);
  const opacity = ghost ? 0.1 : 1;

  const setCursor = (cursor: string) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = cursor;
  };

  return (
    <group position={[0, y, 0]}>
      {geometry.slab && (
        <mesh geometry={geometry.slab}>
          <meshStandardMaterial
            color={theme.floor}
            transparent={ghost}
            opacity={opacity}
            depthWrite={!ghost}
          />
        </mesh>
      )}
      {!ghost &&
        geometry.rooms.map(({ room, geometry: g }) => {
          const highlighted = room.id === highlightRoomId;
          const color = highlighted
            ? theme.roomHighlight
            : room.departmentId
              ? (colors.get(room.departmentId) ?? theme.roomFill)
              : theme.roomFill;
          return (
            <mesh
              key={room.id}
              geometry={g}
              onClick={
                onRoomClick
                  ? (e) => {
                      e.stopPropagation();
                      onRoomClick(room);
                    }
                  : undefined
              }
              onPointerOver={onRoomClick ? setCursor('pointer') : undefined}
              onPointerOut={onRoomClick ? setCursor('') : undefined}
            >
              <meshStandardMaterial
                color={color}
                transparent
                opacity={highlighted ? 0.85 : 0.45}
                depthWrite={false}
              />
            </mesh>
          );
        })}
      {geometry.walls.solid && (
        <mesh geometry={geometry.walls.solid}>
          <meshStandardMaterial
            color={theme.wall3d}
            transparent={ghost}
            opacity={opacity}
            depthWrite={!ghost}
          />
        </mesh>
      )}
      {geometry.walls.glass && !ghost && (
        <mesh geometry={geometry.walls.glass}>
          <meshStandardMaterial color={theme.glass} transparent opacity={0.45} depthWrite={false} />
        </mesh>
      )}
      {!ghost &&
        geometry.elevators.map(({ connector, geometry: g }) => (
          <mesh key={connector.id} geometry={g}>
            <meshStandardMaterial
              color={connectorColor(connector, theme.connectorStroke)}
              transparent
              opacity={0.35}
              depthWrite={false}
            />
          </mesh>
        ))}
      {!ghost && <Stairs3D geometry={geometry.stairs} theme={theme} labels={stairLabels} />}
      {label && !ghost && bounds && (
        <TextLabel
          position={[bounds.minX, wallHeight + 0.2, bounds.maxY]}
          anchor={[0, 0]}
          depthTest
          text={label}
          color={theme.wall}
          textColor={theme.background}
        />
      )}
    </group>
  );
}

/* ------------------------------------------------------------------ */

/** Thang bộ/thang cuốn: vế lên nổi trên sàn, vế xuống chìm qua hố sàn, mũi tên và chữ trên dốc. */
function Stairs3D({
  geometry,
  theme,
  labels,
}: {
  geometry: StairGeometry;
  theme: MapTheme;
  labels: Record<FlightDirection, { texture: THREE.Texture }>;
}) {
  // Vế xuống tối hơn vế lên một chút để gợi cảm giác chìm sâu.
  const downColor = useMemo(
    () =>
      new THREE.Color(theme.connectorStroke)
        .lerp(new THREE.Color(theme.background), 0.35)
        .getStyle(),
    [theme.connectorStroke, theme.background],
  );

  return (
    <group>
      {geometry.up && (
        <mesh geometry={geometry.up}>
          <meshStandardMaterial color={theme.connectorStroke} />
        </mesh>
      )}
      {geometry.down && (
        <mesh geometry={geometry.down}>
          <meshStandardMaterial color={downColor} />
        </mesh>
      )}
      {geometry.pit && (
        <mesh geometry={geometry.pit}>
          <meshStandardMaterial color={theme.wall3d} />
        </mesh>
      )}
      {geometry.arrows && (
        <mesh geometry={geometry.arrows}>
          <meshBasicMaterial color={theme.background} side={THREE.DoubleSide} />
        </mesh>
      )}
      {(['up', 'down'] as const).map((dir) => {
        const g = geometry.labels[dir];
        return g ? (
          <mesh key={dir} geometry={g}>
            <meshBasicMaterial map={labels[dir].texture} transparent side={THREE.DoubleSide} />
          </mesh>
        ) : null;
      })}
    </group>
  );
}

/* ------------------------------------------------------------------ */

interface FloorChange {
  from: Vec3;
  to: Vec3;
  label: string;
}

export function Route3D({
  route,
  floors,
  floorY,
  stairs,
  wallHeightScale,
  theme,
  destinationLabel,
}: {
  route: Route;
  floors: readonly Floor[];
  floorY: ReadonlyMap<Id, number>;
  stairs: ReadonlyMap<Id, StairLayout>;
  wallHeightScale: number;
  theme: MapTheme;
  destinationLabel?: string;
}) {
  // Mỗi tầng vẽ một đường riêng. Đoạn nối giữa các tầng vẽ khác hẳn (nét đứt + mũi tên + nhãn)
  // để không bị đọc nhầm thành một lối đi xuyên qua các phòng.
  const { legs, changes } = useMemo(() => {
    const floorById = new Map(floors.map((floor, index) => [floor.id, { floor, index }]));
    const legs = route.segments.flatMap((segment, k) => {
      const here = floorById.get(segment.floorId);
      const y = floorY.get(segment.floorId);
      if (!here || y === undefined || segment.path.length === 0) return [];
      const height = here.floor.height * wallHeightScale;
      let path = segment.path;
      let head: Vec3[] = [];
      let tail: Vec3[] = [];

      // Cuối đoạn: đi hết vế lên/xuống của thang trên tầng này.
      const exit = segment.transition && stairs.get(segment.transition.connectorId);
      const toIndex = segment.transition && floorById.get(segment.transition.toFloorId)?.index;
      if (exit && toIndex !== undefined) {
        const flight = flightFor(exit, toIndex > here.index ? 'up' : 'down');
        while (path.length > 1 && insideConnector(exit, path[path.length - 1]!)) {
          path = path.slice(0, -1);
        }
        tail = flightPath(flight, height, y, ROUTE_LIFT);
      }

      // Đầu đoạn: vừa tới từ tầng khác. Lên từ tầng dưới thì bước ra từ vế "xuống" của tầng này
      // (đi ngược chiều vế), xuống từ tầng trên thì bước ra từ vế "lên".
      const prev = k > 0 ? route.segments[k - 1] : undefined;
      const prevLayout = prev?.transition && stairs.get(prev.transition.connectorId);
      const linked =
        prevLayout && here.floor.connectors.find((c) => c.linkId === prevLayout.connector.linkId);
      const arrive = linked && stairs.get(linked.id);
      const fromIndex = prev && floorById.get(prev.floorId)?.index;
      if (arrive && fromIndex !== undefined) {
        const flight = flightFor(arrive, fromIndex < here.index ? 'down' : 'up');
        while (path.length > 1 && insideConnector(arrive, path[0]!)) path = path.slice(1);
        head = flightPath(flight, height, y, ROUTE_LIFT).reverse();
      }

      const points = [...head, ...path.map((p) => toVec3(p, y + ROUTE_LIFT)), ...tail];
      return [{ segment, points }];
    });
    const changes: FloorChange[] = [];
    for (let i = 0; i + 1 < legs.length; i++) {
      const { segment, points } = legs[i]!;
      const next = legs[i + 1]!;
      if (!segment.transition || next.segment.floorId !== segment.transition.toFloorId) continue;
      const toName = floorById.get(next.segment.floorId)?.floor.name ?? next.segment.floorId;
      changes.push({
        from: points[points.length - 1]!,
        to: next.points[0]!,
        label: `${CONNECTOR_LABEL[segment.transition.connectorType]} → ${toName}`,
      });
    }
    return { legs, changes };
  }, [route, floors, floorY, stairs, wallHeightScale]);

  if (legs.length === 0) return null;
  const start = legs[0]!.points[0]!;
  const lastPoints = legs[legs.length - 1]!.points;
  const end = lastPoints[lastPoints.length - 1]!;

  return (
    <group>
      {legs.map(({ segment, points }, i) =>
        points.length >= 2 ? (
          <Line key={`${segment.floorId}:${i}`} points={points} color={theme.route} lineWidth={6} />
        ) : null,
      )}
      {changes.map((change, i) => (
        <FloorChange3D key={i} change={change} theme={theme} />
      ))}
      <mesh position={start}>
        <sphereGeometry args={[0.3, 20, 12]} />
        <meshStandardMaterial color={theme.route} />
      </mesh>
      <group position={end}>
        <mesh position={[0, 0.9, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.35, 1, 20]} />
          <meshStandardMaterial color={theme.destination} />
        </mesh>
        <mesh position={[0, 1.55, 0]}>
          <sphereGeometry args={[0.45, 24, 16]} />
          <meshStandardMaterial color={theme.destination} />
        </mesh>
        {destinationLabel && (
          <TextLabel position={[0, 2.1, 0]} text={destinationLabel} color={theme.destination} />
        )}
      </group>
    </group>
  );
}

const UP = new THREE.Vector3(0, 1, 0);

/** Điểm chuyển tầng: đĩa đánh dấu ở hai đầu, nét đứt nối hai tầng, mũi tên chỉ hướng lên/xuống. */
function FloorChange3D({ change, theme }: { change: FloorChange; theme: MapTheme }) {
  const { from, to, label } = change;
  const arrow = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const dir = b.clone().sub(a);
    const size = THREE.MathUtils.clamp(dir.length() * 0.08, 0.5, 1.2);
    return {
      position: a.lerp(b, 0.5).toArray() as Vec3,
      quaternion: new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()),
      size,
    };
  }, [from, to]);

  return (
    <group>
      <Line
        points={[from, to]}
        color={theme.route}
        lineWidth={3}
        dashed
        dashSize={0.5}
        gapSize={0.35}
      />
      <mesh position={arrow.position} quaternion={arrow.quaternion}>
        <coneGeometry args={[arrow.size * 0.45, arrow.size, 20]} />
        <meshStandardMaterial color={theme.route} />
      </mesh>
      {[from, to].map((p, i) => (
        <mesh key={i} position={p}>
          <cylinderGeometry args={[0.45, 0.45, 0.08, 24]} />
          <meshStandardMaterial color={theme.route} />
        </mesh>
      ))}
      <TextLabel
        position={[from[0], from[1] + 0.5, from[2]]}
        text={label}
        color={theme.route}
        textColor={theme.routeCasing}
      />
    </group>
  );
}
