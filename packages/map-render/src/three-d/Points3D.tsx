/**
 * Mô hình 3D cho từng điểm trên bản đồ: mốc trong nhà (`Landmark`) và điểm ngoài trời (`SitePoi`).
 * Mỗi điểm = mô hình theo loại (xem `pointModels.ts`) + huy hiệu tròn mang biểu tượng của loại đó
 * nổi phía trên (cùng biểu tượng với bản đồ 2D) để nhận ra ngay từ xa.
 */
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { Id, Landmark, SitePoi } from '@hwn/map-core';
import { LANDMARK_STYLE } from '../core/landmarks';
import { SITE_POI_STYLE } from '../two-d/siteLayers';
import { toVec3, type Vec3 } from './geometry';
import { landmarkPointModel, POINT_MODEL_MATERIAL, sitePoiPointModel } from './pointModels';

const BADGE_PX = 26;
const BADGE_RES = 3;

/** Huy hiệu tròn: nền màu loại điểm, viền trắng, biểu tượng (path SVG khung 24×24) nét trắng. */
function makeBadgeTexture(color: string, icon: string, ring: string) {
  const size = BADGE_PX * BADGE_RES;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const r = size / 2;
  ctx.beginPath();
  ctx.arc(r, r, r - BADGE_RES, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2 * BADGE_RES;
  ctx.strokeStyle = ring;
  ctx.stroke();
  try {
    const k = (size * 0.58) / 24;
    ctx.translate(r - 12 * k, r - 12 * k);
    ctx.scale(k, k);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(new Path2D(icon));
  } catch {
    // Trình duyệt không có Path2D: chỉ hiện chấm màu.
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Huy hiệu biểu tượng luôn quay về camera, giữ nguyên kích thước trên màn hình. */
export function IconBadge({
  position,
  color,
  icon,
  highlighted = false,
}: {
  position: Vec3;
  color: string;
  icon: string;
  highlighted?: boolean;
}) {
  const ring = highlighted ? '#f97316' : '#ffffff';
  const texture = useMemo(() => makeBadgeTexture(color, icon, ring), [color, icon, ring]);
  useEffect(() => () => texture.dispose(), [texture]);
  const viewportHeight = useThree((s) => s.size.height);
  const fov = useThree((s) => (s.camera instanceof THREE.PerspectiveCamera ? s.camera.fov : 45));
  const f = 1 / Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  const px = highlighted ? BADGE_PX * 1.3 : BADGE_PX;
  const h = px / ((f / 2) * Math.max(viewportHeight, 1));
  return (
    <sprite position={position} scale={[h, h, 1]} center={[0.5, 0]} renderOrder={9}>
      <spriteMaterial map={texture} sizeAttenuation={false} depthTest={false} transparent />
    </sprite>
  );
}

/** Mô hình 3D các mốc trên một tầng (toạ độ mặt bằng tầng, đặt trên mặt sàn y = 0). */
export function LandmarkModels({
  landmarks,
  highlightId,
}: {
  landmarks: readonly Landmark[];
  highlightId?: Id | null;
}) {
  return (
    <group>
      {landmarks.map((l) => {
        const style = LANDMARK_STYLE[l.kind] ?? LANDMARK_STYLE.other;
        const model = landmarkPointModel(l.kind, style.color);
        return (
          <group key={l.id} position={toVec3(l.position, 0)}>
            <mesh geometry={model.geometry} material={POINT_MODEL_MATERIAL} />
            <IconBadge
              position={[0, model.height + 0.25, 0]}
              color={style.color}
              icon={style.icon}
              highlighted={l.id === highlightId}
            />
          </group>
        );
      })}
    </group>
  );
}

/** Mô hình 3D các điểm ngoài trời (toạ độ mặt bằng tổng thể, đặt trên mặt đất cao `ground`). */
export function SitePoiModels({
  pois,
  ground = 0,
  highlightId,
}: {
  pois: readonly SitePoi[];
  /** Cao độ mặt đất tại điểm (m) — vd. điểm nằm trên bệ sảnh. */
  ground?: number | ((poi: SitePoi) => number);
  highlightId?: Id | null;
}) {
  return (
    <group>
      {pois.map((p) => {
        const style = SITE_POI_STYLE[p.kind] ?? SITE_POI_STYLE.other;
        const model = sitePoiPointModel(p.kind, style.color);
        const y = typeof ground === 'function' ? ground(p) : ground;
        return (
          <group key={p.id} position={toVec3(p.position, y)}>
            <mesh geometry={model.geometry} material={POINT_MODEL_MATERIAL} />
            <IconBadge
              position={[0, model.height + 0.4, 0]}
              color={style.color}
              icon={style.icon}
              highlighted={p.id === highlightId}
            />
          </group>
        );
      })}
    </group>
  );
}
