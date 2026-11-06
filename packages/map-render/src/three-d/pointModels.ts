/**
 * Mô hình 3D dựng bằng khối cơ bản (low-poly, tô màu theo đỉnh) cho từng loại điểm trên bản đồ:
 * mốc trong nhà (quầy thông tin, máy lấy số, ATM, nhà vệ sinh…), điểm ngoài trời (ki-ốt, nhà chờ
 * xe buýt, chốt bảo vệ, trạm sạc…) và cổng khuôn viên. Mỗi mô hình là MỘT geometry đã gộp (một draw
 * call), vẽ bằng một vật liệu chung `vertexColors`.
 *
 * Hệ trục mô hình: gốc ở tâm chân đế trên mặt sàn, Y hướng lên, mặt trước quay về +Z (phía camera
 * mặc định), đơn vị mét theo kích thước thật.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LandmarkKind, SiteGate, SitePoiKind } from '@hwn/map-core';

/* ------------------------------------------------------------------ */
/* Bộ dựng                                                             */
/* ------------------------------------------------------------------ */

type V3 = readonly [number, number, number];

const WHITE = '#f8fafc';
const LIGHT = '#e2e8f0';
const GREY = '#94a3b8';
const STEEL = '#64748b';
const DARK = '#1e293b';
const SCREEN = '#0f172a';
const DISPLAY = '#38bdf8';
const GLASS = '#bae6fd';
const WOOD = '#b45309';
const SHELF = '#e7e5e4';

/** Gộp các khối cơ bản (mỗi khối một màu) thành một geometry có thuộc tính `color`. */
export class ModelBuilder {
  private parts: THREE.BufferGeometry[] = [];
  private stack: THREE.Matrix4[];

  constructor(root?: THREE.Matrix4) {
    this.stack = [root ?? new THREE.Matrix4()];
  }

  private get matrix() {
    return this.stack[this.stack.length - 1]!;
  }

  /** Dựng các khối trong `fn` theo hệ trục con: dời tới `at`, xoay quanh trục đứng / ngang. */
  group(at: V3, rot: V3, fn: () => void): this {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...at),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
      new THREE.Vector3(1, 1, 1),
    );
    this.stack.push(this.matrix.clone().multiply(m));
    fn();
    this.stack.pop();
    return this;
  }

  add(geometry: THREE.BufferGeometry, color: string, at: V3, rot: V3 = [0, 0, 0]): this {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    g.deleteAttribute('uv');
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(...at),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
      new THREE.Vector3(1, 1, 1),
    );
    g.applyMatrix4(this.matrix.clone().multiply(local));
    const c = new THREE.Color(color);
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.push(g);
    return this;
  }

  /** Hộp kích thước `w × h × d`, tâm tại `at`. */
  box(w: number, h: number, d: number, at: V3, color: string, rot?: V3): this {
    return this.add(new THREE.BoxGeometry(w, h, d), color, at, rot);
  }

  /** Hộp đặt trên mặt phẳng y = `at[1]` (tâm đáy tại `at`). */
  block(w: number, h: number, d: number, at: V3, color: string, rot?: V3): this {
    return this.box(w, h, d, [at[0], at[1] + h / 2, at[2]], color, rot);
  }

  /** Trụ tròn (hoặc nón khi `top = 0`), tâm tại `at`, trục theo Y trước khi xoay. */
  cylinder(top: number, bottom: number, h: number, at: V3, color: string, rot?: V3, seg = 16) {
    return this.add(new THREE.CylinderGeometry(top, bottom, h, seg), color, at, rot);
  }

  /** Đĩa tròn đứng quay mặt về +Z (biển hiệu). */
  disc(r: number, depth: number, at: V3, color: string): this {
    return this.cylinder(r, r, depth, at, color, [Math.PI / 2, 0, 0], 24);
  }

  sphere(r: number, at: V3, color: string): this {
    return this.add(new THREE.SphereGeometry(r, 16, 12), color, at);
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false);
    for (const g of this.parts) g.dispose();
    this.parts = [];
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  }
}

/* ------------------------------------------------------------------ */
/* Chi tiết dùng chung                                                 */
/* ------------------------------------------------------------------ */

/** Dấu chữ thập (nhà thuốc, cấp cứu) quay mặt về +Z. */
function cross(b: ModelBuilder, size: number, at: V3, color: string, depth = 0.06) {
  const t = size * 0.32;
  b.box(size, t, depth, at, color);
  b.box(t, size, depth, at, color);
}

/** Biển trên cột: cột đứng + bảng vuông viền trắng. */
function signPost(
  b: ModelBuilder,
  x: number,
  z: number,
  height: number,
  size: number,
  color: string,
) {
  b.cylinder(0.05, 0.05, height, [x, height / 2, z], STEEL);
  b.box(size + 0.08, size + 0.08, 0.05, [x, height + size / 2 - 0.1, z], WHITE);
  b.box(size, size, 0.07, [x, height + size / 2 - 0.1, z + 0.01], color);
}

/** Ki-ốt nhỏ: thân, ô cửa bán hàng có bậu, mái hiên kẻ sọc. */
function kioskHut(b: ModelBuilder, color: string, body = LIGHT) {
  b.block(3, 2.4, 2.4, [0, 0, 0], body);
  b.block(3.2, 0.16, 2.6, [0, 2.4, 0], color);
  b.box(2.2, 1.0, 0.05, [0, 1.45, 1.21], SCREEN);
  b.box(2.4, 0.08, 0.45, [0, 0.95, 1.4], WOOD);
  // Mái hiên sọc nghiêng xuống phía trước.
  for (let i = 0; i < 6; i++) {
    b.box(0.5, 0.05, 0.95, [-1.25 + i * 0.5, 2.3, 1.55], i % 2 ? WHITE : color, [0.38, 0, 0]);
  }
}

/** Ghế đơn: mặt ngồi + tựa lưng. */
function chair(b: ModelBuilder, x: number, z: number, color: string, ry = 0) {
  b.group([x, 0, z], [0, ry, 0], () => {
    b.box(0.5, 0.06, 0.45, [0, 0.45, 0], color);
    b.box(0.5, 0.45, 0.05, [0, 0.7, -0.22], color, [-0.12, 0, 0]);
  });
}

/* ------------------------------------------------------------------ */
/* Mốc trong nhà                                                       */
/* ------------------------------------------------------------------ */

function landmarkModel(kind: LandmarkKind, color: string): THREE.BufferGeometry {
  const b = new ModelBuilder();
  switch (kind) {
    case 'info':
      // Quầy thông tin: bàn có dải màu mặt trước + biển "i" tròn trên cột.
      b.block(1.6, 0.95, 0.6, [0, 0, 0], LIGHT);
      b.box(1.62, 0.32, 0.04, [0, 0.62, 0.31], color);
      b.box(1.72, 0.05, 0.72, [0, 0.975, 0], DARK);
      b.cylinder(0.03, 0.03, 1.3, [0.62, 1.65, -0.22], STEEL);
      b.disc(0.28, 0.05, [0.62, 2.3, -0.22], color);
      b.disc(0.2, 0.06, [0.62, 2.3, -0.21], WHITE);
      b.box(0.06, 0.2, 0.07, [0.62, 2.26, -0.18], color);
      b.box(0.06, 0.06, 0.07, [0.62, 2.42, -0.18], color);
      break;
    case 'kiosk':
      // Máy lấy số: thân đứng, màn hình nghiêng, khe nhả phiếu.
      b.block(0.66, 0.06, 0.56, [0, 0, 0], DARK);
      b.block(0.55, 1.42, 0.45, [0, 0.06, 0], color);
      b.box(0.44, 0.5, 0.04, [0, 1.08, 0.24], SCREEN, [-0.3, 0, 0]);
      b.box(0.38, 0.42, 0.045, [0, 1.08, 0.245], DISPLAY, [-0.3, 0, 0]);
      b.box(0.22, 0.04, 0.05, [0, 0.72, 0.24], DARK);
      b.block(0.55, 0.12, 0.45, [0, 1.48, 0], WHITE);
      break;
    case 'cashier':
      // Quầy thu ngân: quầy dài, vách kính, máy tính tiền.
      b.block(2.0, 1.05, 0.7, [0, 0, 0], LIGHT);
      b.box(2.02, 0.22, 0.04, [0, 0.82, 0.36], color);
      b.box(2.1, 0.05, 0.8, [0, 1.075, 0], DARK);
      b.box(2.0, 0.65, 0.03, [0, 1.42, 0.12], GLASS);
      b.box(0.2, 0.12, 0.04, [0, 1.16, 0.12], DARK);
      b.block(0.42, 0.18, 0.34, [0.55, 1.1, -0.12], DARK);
      b.box(0.32, 0.22, 0.03, [0.55, 1.42, -0.04], DISPLAY, [-0.25, 0, 0]);
      break;
    case 'pharmacy':
      // Nhà thuốc: quầy + tủ thuốc phía sau + biển chữ thập xanh.
      b.block(1.8, 1.0, 0.6, [0, 0, 0.35], LIGHT);
      b.box(1.82, 0.24, 0.04, [0, 0.78, 0.66], color);
      b.block(2.0, 2.0, 0.4, [0, 0, -0.45], SHELF);
      for (const y of [0.55, 1.05, 1.55]) b.box(1.9, 0.04, 0.3, [0, y, -0.32], STEEL);
      for (let i = 0; i < 6; i++) {
        b.block(0.18, 0.28, 0.18, [-0.75 + i * 0.3, 1.07, -0.38], i % 2 ? color : WHITE);
      }
      b.box(0.62, 0.62, 0.05, [0, 2.4, -0.3], WHITE);
      cross(b, 0.5, [0, 2.4, -0.27], color);
      break;
    case 'restroom':
      // Biển nhà vệ sinh: trụ đứng với hình người nam / nữ.
      b.block(0.6, 0.06, 0.3, [0, 0, 0], DARK);
      b.block(0.52, 2.0, 0.14, [0, 0.06, 0], '#475569');
      for (const [x, c] of [
        [-0.13, '#3b82f6'],
        [0.13, '#ec4899'],
      ] as const) {
        b.disc(0.06, 0.03, [x, 1.72, 0.08], c);
        b.box(0.12, 0.3, 0.03, [x, 1.47, 0.08], c);
        b.box(0.04, 0.22, 0.03, [x - 0.03, 1.2, 0.08], c);
        b.box(0.04, 0.22, 0.03, [x + 0.03, 1.2, 0.08], c);
      }
      b.box(0.02, 0.8, 0.03, [0, 1.42, 0.08], WHITE);
      break;
    case 'atm':
      // Cây ATM: thân máy, hốc giao dịch, màn hình, bàn phím, hộp đèn trên đầu.
      b.block(0.86, 1.72, 0.75, [0, 0, 0], color);
      b.box(0.72, 0.9, 0.06, [0, 1.06, 0.36], DARK);
      b.box(0.42, 0.3, 0.03, [0, 1.3, 0.4], DISPLAY, [-0.15, 0, 0]);
      b.box(0.3, 0.04, 0.2, [0, 0.95, 0.46], GREY);
      b.box(0.24, 0.03, 0.05, [0, 0.8, 0.4], SCREEN);
      b.block(0.92, 0.26, 0.8, [0, 1.72, 0], WHITE);
      break;
    case 'water':
      // Cây nước: tủ máy + bình nước xanh trên đỉnh.
      b.block(0.38, 1.0, 0.38, [0, 0, 0], WHITE);
      b.box(0.3, 0.26, 0.04, [0, 0.74, 0.18], DARK);
      b.box(0.04, 0.06, 0.06, [-0.07, 0.83, 0.22], '#ef4444');
      b.box(0.04, 0.06, 0.06, [0.07, 0.83, 0.22], '#3b82f6');
      b.cylinder(0.16, 0.16, 0.42, [0, 1.25, 0], color);
      b.cylinder(0.06, 0.12, 0.08, [0, 1.04, 0], color);
      break;
    case 'waiting':
      // Dãy ghế chờ 4 chỗ trên thanh dầm chung.
      b.box(2.4, 0.05, 0.08, [0, 0.38, 0], DARK);
      for (const x of [-1.1, 1.1]) b.block(0.06, 0.38, 0.42, [x, 0, 0], DARK);
      for (const x of [-0.9, -0.3, 0.3, 0.9]) chair(b, x, 0, color);
      break;
    case 'canteen':
      // Bàn tròn + 4 ghế đôn.
      b.cylinder(0.55, 0.55, 0.05, [0, 0.75, 0], WOOD, undefined, 24);
      b.cylinder(0.05, 0.05, 0.72, [0, 0.36, 0], DARK);
      b.cylinder(0.28, 0.28, 0.03, [0, 0.015, 0], DARK, undefined, 20);
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        b.cylinder(0.18, 0.16, 0.45, [Math.cos(a) * 0.85, 0.225, Math.sin(a) * 0.85], color);
      }
      break;
    case 'other':
      pinTotem(b, color, 1);
      break;
  }
  return b.build();
}

/** Cột ghim chung (loại "khác"). */
function pinTotem(b: ModelBuilder, color: string, k: number) {
  b.cylinder(0.25 * k, 0.3 * k, 0.08 * k, [0, 0.04 * k, 0], DARK, undefined, 20);
  b.cylinder(0.04 * k, 0.04 * k, 1.4 * k, [0, 0.75 * k, 0], STEEL);
  b.sphere(0.26 * k, [0, 1.62 * k, 0], color);
  b.cylinder(0.12 * k, 0, 0.3 * k, [0, 1.3 * k, 0], color, [Math.PI, 0, 0]);
}

/* ------------------------------------------------------------------ */
/* Điểm ngoài trời                                                     */
/* ------------------------------------------------------------------ */

function poiModel(kind: SitePoiKind, color: string): THREE.BufferGeometry {
  const b = new ModelBuilder();
  switch (kind) {
    case 'atm':
      // Buồng ATM: buồng đứng, hốc giao dịch, mái hắt.
      b.block(1.5, 2.4, 1.3, [0, 0, 0], color);
      b.box(1.1, 1.3, 0.06, [0, 1.3, 0.66], DARK);
      b.box(0.5, 0.36, 0.03, [0, 1.55, 0.7], DISPLAY);
      b.box(0.36, 0.04, 0.24, [0, 1.15, 0.78], GREY);
      b.block(1.8, 0.14, 1.7, [0, 2.4, 0.15], DARK);
      b.box(1.5, 0.3, 0.04, [0, 2.2, 0.66], WHITE);
      break;
    case 'shop':
      kioskHut(b, color);
      break;
    case 'canteen':
      kioskHut(b, color, '#fff7ed');
      // Bàn có dù che phía trước.
      for (const x of [-2.6, 2.6]) {
        b.cylinder(0.5, 0.5, 0.05, [x, 0.75, 2.8], WHITE, undefined, 20);
        b.cylinder(0.04, 0.04, 2.3, [x, 1.15, 2.8], STEEL);
        b.cylinder(0, 1.3, 0.55, [x, 2.4, 2.8], color, undefined, 12);
        for (const dz of [-0.8, 0.8]) b.cylinder(0.18, 0.16, 0.45, [x, 0.225, 2.8 + dz], DARK);
      }
      break;
    case 'pharmacy':
      kioskHut(b, color, WHITE);
      b.box(0.9, 0.9, 0.06, [0, 3.0, 1.0], WHITE);
      cross(b, 0.75, [0, 3.0, 1.04], color, 0.08);
      b.box(0.1, 0.5, 0.1, [0, 2.6, 1.0], STEEL);
      break;
    case 'parking':
      signPost(b, 0, 0, 2.6, 0.9, color);
      break;
    case 'bus':
      // Nhà chờ xe buýt: mái, vách kính sau, cột, ghế + biển trạm.
      b.block(4.2, 0.1, 1.9, [0, 2.6, 0], color);
      b.box(4.0, 1.9, 0.05, [0, 1.45, -0.8], GLASS);
      for (const x of [-2, 2]) {
        b.block(0.1, 2.6, 0.1, [x, 0, -0.8], DARK);
        b.box(0.05, 1.9, 1.3, [x, 1.45, -0.15], GLASS);
      }
      b.box(2.4, 0.08, 0.42, [0, 0.48, -0.5], WOOD);
      for (const x of [-1, 1]) b.block(0.06, 0.44, 0.3, [x, 0, -0.5], DARK);
      signPost(b, 2.6, 0.5, 2.5, 0.6, color);
      break;
    case 'taxi':
      // Điểm đón taxi: biển + xe taxi đỗ.
      signPost(b, -1.6, 0, 2.5, 0.6, color);
      b.group([1, 0, 0], [0, 0, 0], () => {
        b.block(1.8, 0.62, 4.1, [0, 0.28, 0], '#facc15');
        b.block(1.6, 0.48, 2.1, [0, 0.9, -0.25], '#facc15');
        b.box(1.63, 0.3, 2.13, [0, 1.12, -0.25], '#334155');
        b.box(0.5, 0.14, 0.22, [0, 1.45, -0.25], WHITE);
        for (const x of [-0.86, 0.86]) {
          for (const z of [-1.3, 1.3]) {
            b.cylinder(0.33, 0.33, 0.24, [x, 0.33, z], DARK, [0, 0, Math.PI / 2], 14);
          }
        }
        b.box(1.4, 0.12, 0.05, [0, 0.62, 2.06], WHITE);
      });
      break;
    case 'security':
      // Chốt bảo vệ: chòi có dải kính, mái đua, cửa.
      b.block(2.4, 2.5, 2.4, [0, 0, 0], LIGHT);
      b.box(2.44, 0.85, 2.44, [0, 1.6, 0], GLASS);
      b.block(3.0, 0.2, 3.0, [0, 2.5, 0], color);
      b.box(0.8, 1.95, 0.05, [0.65, 0.98, 1.22], DARK);
      b.block(0.4, 0.5, 0.05, [-0.6, 2.7, 1.2], WHITE);
      break;
    case 'emergency':
      // Trụ biển Cấp cứu: thân trắng, chữ thập đỏ, đèn trên đỉnh.
      b.block(1.1, 0.2, 0.6, [0, 0, 0], GREY);
      b.block(0.9, 3.4, 0.32, [0, 0.2, 0], WHITE);
      cross(b, 0.68, [0, 2.75, 0.18], color, 0.06);
      b.box(0.7, 0.18, 0.04, [0, 1.75, 0.17], color);
      b.block(0.32, 0.18, 0.32, [0, 3.6, 0], color);
      break;
    case 'restroom':
      // Khối nhà vệ sinh: hai cửa nam / nữ có biển tròn.
      b.block(4, 2.8, 3, [0, 0, 0], LIGHT);
      b.block(4.4, 0.2, 3.4, [0, 2.8, 0], color);
      for (const [x, c] of [
        [-0.9, '#3b82f6'],
        [0.9, '#ec4899'],
      ] as const) {
        b.box(0.9, 2.0, 0.05, [x, 1.0, 1.51], DARK);
        b.disc(0.22, 0.04, [x, 2.4, 1.53], c);
      }
      break;
    case 'info':
      // Bảng thông tin: hai cột, bảng màu có mặt trắng, mái nhỏ.
      for (const x of [-0.95, 0.95]) b.block(0.09, 2.2, 0.09, [x, 0, 0], DARK);
      b.box(2.0, 1.25, 0.1, [0, 1.5, 0], color);
      b.box(1.84, 1.08, 0.02, [0, 1.5, 0.06], WHITE);
      for (let i = 0; i < 4; i++)
        b.box(1.3 - (i % 2) * 0.4, 0.06, 0.02, [-0.15, 1.85 - i * 0.2, 0.075], GREY);
      b.box(2.2, 0.08, 0.32, [0, 2.2, 0], DARK);
      break;
    case 'bike':
      // Bãi xe đạp / xe máy: nền, các khung dựng xe chữ U, mái che.
      b.block(3.8, 0.03, 1.8, [0, 0, 0], LIGHT);
      for (let i = 0; i < 4; i++) {
        const x = -1.35 + i * 0.9;
        b.block(0.05, 0.8, 0.05, [x - 0.3, 0, 0.2], STEEL);
        b.block(0.05, 0.8, 0.05, [x + 0.3, 0, 0.2], STEEL);
        b.box(0.65, 0.05, 0.05, [x, 0.8, 0.2], STEEL);
      }
      for (const x of [-1.8, 1.8]) b.block(0.08, 2.2, 0.08, [x, 0, -0.8], DARK);
      b.box(4, 0.08, 2.1, [0, 2.25, 0.05], color, [-0.12, 0, 0]);
      break;
    case 'ev':
      // Trạm sạc xe điện: trụ sạc, màn hình, đầu sạc + vạch ô đỗ.
      b.block(0.7, 0.08, 0.5, [0, 0, 0], GREY);
      b.block(0.5, 1.6, 0.36, [0, 0.08, 0], color);
      b.box(0.32, 0.26, 0.03, [0, 1.3, 0.19], DISPLAY);
      b.box(0.12, 0.22, 0.12, [0.14, 0.85, 0.22], DARK);
      b.block(0.5, 0.06, 0.36, [0, 1.68, 0], WHITE);
      b.block(2.6, 0.01, 0.12, [0, 0, 0.9], WHITE);
      break;
    case 'other':
      pinTotem(b, color, 1.4);
      break;
  }
  return b.build();
}

/* ------------------------------------------------------------------ */
/* Bộ nhớ đệm                                                          */
/* ------------------------------------------------------------------ */

export interface PointModel {
  geometry: THREE.BufferGeometry;
  /** Đỉnh cao nhất của mô hình (m) — để đặt biểu tượng nổi phía trên. */
  height: number;
}

const cache = new Map<string, PointModel>();

function cached(key: string, make: () => THREE.BufferGeometry): PointModel {
  let m = cache.get(key);
  if (!m) {
    const geometry = make();
    m = { geometry, height: geometry.boundingBox?.max.y ?? 1 };
    cache.set(key, m);
  }
  return m;
}

/** Mô hình mốc trong nhà (dùng chung giữa các mốc cùng loại, cùng màu). */
export const landmarkPointModel = (kind: LandmarkKind, color: string): PointModel =>
  cached(`l:${kind}:${color}`, () => landmarkModel(kind, color));

/** Mô hình điểm ngoài trời (dùng chung giữa các điểm cùng loại, cùng màu). */
export const sitePoiPointModel = (kind: SitePoiKind, color: string): PointModel =>
  cached(`p:${kind}:${color}`, () => poiModel(kind, color));

/** Vật liệu chung cho mọi mô hình điểm (màu theo đỉnh). */
export const POINT_MODEL_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.7,
  metalness: 0.05,
});

/* ------------------------------------------------------------------ */
/* Cổng                                                                */
/* ------------------------------------------------------------------ */

/** Hình học cổng cần để dựng (xem `gateShape`). */
export interface GateFrame {
  /** Hướng đường đi qua cổng (độ). */
  angle: number;
  /** Nửa khoảng cách giữa hai trụ cổng (m). */
  half: number;
}

const GATE_PILLAR = '#475569';
const GATE_METAL = '#334155';

/** Cánh cổng song sắt dài `w`, đặt từ gốc theo trục +X của hệ trục hiện tại. */
function gateLeaf(b: ModelBuilder, w: number, h: number) {
  b.box(w, 0.08, 0.06, [w / 2, h, 0], GATE_METAL);
  b.box(w, 0.08, 0.06, [w / 2, 0.15, 0], GATE_METAL);
  b.box(0.08, h, 0.06, [0.04, h / 2 + 0.05, 0], GATE_METAL);
  b.box(0.08, h, 0.06, [w - 0.04, h / 2 + 0.05, 0], GATE_METAL);
  const bars = Math.max(1, Math.floor(w / 0.18));
  for (let i = 1; i < bars; i++) {
    b.box(0.03, h - 0.1, 0.03, [(w * i) / bars, h / 2 + 0.1, 0], GATE_METAL);
  }
}

/**
 * Dựng cổng theo kiểu cánh, toạ độ mặt bằng tổng thể: hai trụ hai bên lối qua và
 * - `barrier`: tủ điều khiển + thanh chắn sọc đỏ trắng (nâng lên khi cổng mở),
 * - `double`: hai cánh song sắt (mở quay vào trong khi cổng mở),
 * - `sliding`: cánh kéo trên ray (kéo sang bên khi cổng mở),
 * - `open`: dầm biển tên phía trên lối qua.
 */
export function buildGateModel(
  gate: SiteGate,
  frame: GateFrame,
  open: boolean,
): THREE.BufferGeometry {
  const rad = (frame.angle * Math.PI) / 180;
  // Trục X cục bộ = ngang lối qua (pháp tuyến của đường), trục Z cục bộ = dọc đường.
  const nx = -Math.sin(rad);
  const ny = Math.cos(rad);
  const root = new THREE.Matrix4().compose(
    new THREE.Vector3(gate.position.x, 0, gate.position.y),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-ny, nx)),
    new THREE.Vector3(1, 1, 1),
  );
  const b = new ModelBuilder(root);
  const half = frame.half;
  const style = gate.style ?? (gate.kind === 'pedestrian' ? 'double' : 'barrier');
  const accent = gate.kind === 'pedestrian' ? '#0f766e' : '#1d4ed8';

  for (const s of [-1, 1]) {
    b.block(0.55, 2.6, 0.55, [s * (half + 0.28), 0, 0], GATE_PILLAR);
    b.block(0.68, 0.12, 0.68, [s * (half + 0.28), 2.6, 0], GATE_METAL);
  }

  switch (style) {
    case 'barrier': {
      const pivot = -half + 0.25;
      b.block(0.42, 1.05, 0.42, [pivot, 0, 0.45], '#facc15');
      const len = 2 * half - 0.4;
      const tilt = open ? Math.PI * 0.44 : 0;
      b.group([pivot, 1.0, 0.45], [0, 0, tilt], () => {
        const n = Math.max(2, Math.round(len / 0.5));
        for (let i = 0; i < n; i++) {
          b.box(len / n, 0.1, 0.08, [(len * (i + 0.5)) / n, 0, 0], i % 2 ? WHITE : '#dc2626');
        }
      });
      break;
    }
    case 'double': {
      const w = half - 0.02;
      const swing = open ? Math.PI * 0.45 : 0;
      b.group([-half, 0, 0], [0, -swing, 0], () => gateLeaf(b, w, 1.8));
      b.group([half, 0, 0], [0, Math.PI + swing, 0], () => gateLeaf(b, w, 1.8));
      break;
    }
    case 'sliding': {
      const w = 2 * half;
      b.block(w * 2 + 0.8, 0.04, 0.12, [half + 0.4, 0, 0], GATE_METAL);
      b.group([open ? half + 0.6 : -half, 0, 0], [0, 0, 0], () => gateLeaf(b, w, 1.8));
      break;
    }
    case 'open':
      b.box(2 * half + 1.2, 0.5, 0.4, [0, 2.95, 0], accent);
      b.box(2 * half * 0.7, 0.3, 0.02, [0, 2.95, 0.21], WHITE);
      break;
  }
  return b.build();
}
