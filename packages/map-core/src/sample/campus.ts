/**
 * Cơ sở mẫu: toà chính (40 x 20 m) và Khu B đặt phía nam, cách một sân vườn 15 m.
 *
 *          x=-46      -27 -16  -8 -4 0                40   45  52   64
 *   y=-20  ━━━━━━━━━━━━━━━━[cổng phụ]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  hàng rào
 *   y=0     ┌─ bãi ô tô ─┐   ║║  ╱▓┃ ┌──── toà chính ────┐
 *           │  ▭▭    ▭▭ ═╪═══╣║  ▓▓┃▒⇥ cửa chính (y=10)  │
 *   y=20    │            │   ║║  ╲▓┃ └───────────────────┘
 *           │            │···║║····┃  ░░░ sân vườn ░░░░░░░ ─── căng tin
 *   y=35    └────────────┘   ║║  ╱▓┃ ┌────── Khu B ──────┐
 *                            ║║  ▓▓┃▒⇥ cửa chính (y=45)  │
 *         ┌ bãi xe máy ┐     ║║  ╲▓┃ └───────────────────┘
 *   y=62  │      ◄══════╗    ╠╬═════╪════════════════════════╝  đường ô tô vòng (một chiều)
 *         └────────────┘║ ▣  ║║     │  sân trước cổng
 *   y=79  ━━━━━━━━━[cổng xe máy]━[cổng chính]━━[cổng đi bộ]━━━━━━━━━━━━━  hàng rào
 *   y=81  ════════════════════ đường công cộng ═══════════════════
 *
 *   ║║ đường chung (lòng đường + vỉa hè 2 bên) · ║ đường xe · ┃ lối có mái che · │ ··· lối đi bộ
 *   ╱ ╲ dốc lên sảnh · ▓ làn đón / trả khách · ▒ sảnh · ▣ bốt bảo vệ
 *
 * Sảnh, làn đón và hai dốc trước mỗi cửa chính là phần ngoài trời CỦA TOÀ (`Building.exterior`, vẽ ở
 * trang Vẽ toà nhà) — khuôn viên chỉ có đường nội bộ đi qua chân dốc (đầu nối của toà).
 */
import type { Campus, SitePlan } from '../campus';
import { campusSitePlan } from '../exterior';
import type { Point } from '../types';
import { createSampleAnnex, SAMPLE_ANNEX_ID } from './annex';
import { createSampleBuilding, SAMPLE_BUILDING_ID } from './index';

export const SAMPLE_CAMPUS_ID = 'campus_main';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

export const createSampleCampus = (): Campus => ({
  id: SAMPLE_CAMPUS_ID,
  name: 'Cơ sở chính',
  code: 'CS1',
  address: '123 Đường Mẫu, Quận 1, TP. HCM',
  geo: { lat: 10.7769, lng: 106.7009 },
  buildings: [
    { buildingId: SAMPLE_BUILDING_ID, position: { x: 0, y: 0 }, rotation: 0 },
    { buildingId: SAMPLE_ANNEX_ID, position: { x: 0, y: 35 }, rotation: 0 },
  ],
  site: {
    areas: [
      {
        id: 'site_street',
        kind: 'road',
        name: 'Đường Mẫu (đường công cộng)',
        polygon: rect(-56, 81, 70, 89),
      },
      {
        id: 'site_street_back',
        kind: 'road',
        name: 'Đường phía sau',
        polygon: rect(-56, -30, 70, -22),
      },
      {
        id: 'site_parking',
        kind: 'parking',
        name: 'Bãi xe ô tô',
        polygon: rect(-46, -2, -24, 36),
      },
      {
        id: 'site_bike_parking',
        kind: 'bike_parking',
        name: 'Bãi xe máy',
        polygon: rect(-46, 46, -30, 74),
      },
      { id: 'site_garden', kind: 'green', name: 'Sân vườn', polygon: rect(2, 22, 38, 33) },
      {
        id: 'site_canteen',
        kind: 'structure',
        name: 'Nhà căng tin',
        polygon: rect(45, 22, 58, 33),
      },
      { id: 'site_guard', kind: 'structure', polygon: rect(-24.8, 71, -22.2, 75.5) },
      { id: 'site_plaza', kind: 'plaza', name: 'Sân trước cổng', polygon: rect(-9.5, 66, 6, 79) },
    ],
    paths: [
      {
        id: 'site_fence',
        kind: 'fence',
        name: 'Hàng rào khuôn viên',
        width: 0.3,
        points: [
          { x: -50, y: -20 },
          { x: 64, y: -20 },
          { x: 64, y: 79 },
          { x: -50, y: 79 },
          { x: -50, y: -20 },
        ],
      },
      {
        id: 'site_road_west',
        kind: 'shared',
        name: 'Đường nội bộ',
        width: 11,
        sidewalk: 2,
        points: [
          { x: -16, y: 83 },
          { x: -16, y: -24 },
        ],
      },
      {
        id: 'site_road_south',
        kind: 'vehicle',
        name: 'Đường ô tô vòng phía nam',
        width: 6,
        oneWay: true,
        vehicles: 'car',
        points: [
          { x: -16, y: 62 },
          { x: 52, y: 62 },
          { x: 52, y: 40 },
        ],
      },
      {
        id: 'site_road_parking',
        kind: 'vehicle',
        name: 'Lối vào bãi ô tô',
        width: 6,
        vehicles: 'car',
        points: [
          { x: -16, y: 12 },
          { x: -33, y: 12 },
        ],
      },
      {
        id: 'site_road_bike',
        kind: 'vehicle',
        name: 'Làn xe máy vào bãi',
        width: 3,
        vehicles: 'motorbike',
        points: [
          { x: -27, y: 83 },
          { x: -27, y: 60 },
          { x: -36, y: 60 },
        ],
      },
      {
        id: 'site_walkway',
        kind: 'covered',
        name: 'Hành lang có mái che',
        width: 3,
        points: [
          { x: -4, y: 10 },
          { x: -4, y: 45 },
        ],
      },
      {
        id: 'site_gate_path',
        kind: 'pedestrian',
        name: 'Lối đi bộ từ cổng',
        width: 2.5,
        points: [
          { x: -4, y: 83 },
          { x: -4, y: 45 },
        ],
      },
      {
        id: 'site_parking_path',
        kind: 'pedestrian',
        name: 'Lối từ bãi xe',
        width: 2,
        points: [
          { x: -24, y: 27.5 },
          { x: -4, y: 27.5 },
        ],
      },
      {
        id: 'site_garden_path',
        kind: 'pedestrian',
        name: 'Lối qua sân vườn',
        width: 2,
        points: [
          { x: -4, y: 27.5 },
          { x: 45, y: 27.5 },
        ],
      },
    ],
    gates: [
      {
        id: 'site_gate_bike',
        name: 'Cổng xe máy',
        kind: 'vehicle',
        position: { x: -27, y: 79 },
        style: 'sliding',
        schedule: { open: '05:30', close: '22:00' },
      },
      {
        id: 'site_gate_main',
        name: 'Cổng chính',
        kind: 'both',
        position: { x: -16, y: 79 },
        style: 'barrier',
      },
      {
        id: 'site_gate_walk',
        name: 'Cổng đi bộ',
        kind: 'pedestrian',
        position: { x: -4, y: 79 },
        style: 'double',
        schedule: { open: '05:00', close: '22:00' },
      },
      {
        id: 'site_gate_north',
        name: 'Cổng phụ phía bắc',
        kind: 'vehicle',
        position: { x: -16, y: -20 },
        style: 'sliding',
        schedule: { open: '06:00', close: '18:00' },
      },
    ],
    pois: [
      {
        id: 'poi_atm',
        name: 'Cây ATM ngoài trời',
        kind: 'atm',
        position: { x: -6.5, y: 31 },
        tags: ['atm', 'rút tiền', 'ngân hàng'],
      },
      {
        id: 'poi_kiosk',
        name: 'Ki-ốt tạp hoá',
        kind: 'shop',
        position: { x: 20, y: 30 },
        tags: ['bán hàng', 'tạp hoá', 'nước', 'đồ ăn'],
      },
      {
        id: 'poi_canteen',
        name: 'Căng tin',
        kind: 'canteen',
        position: { x: 51.5, y: 27.5 },
        tags: ['ăn uống', 'cơm', 'cà phê'],
      },
      {
        id: 'poi_parking',
        name: 'Lối vào bãi xe',
        kind: 'parking',
        position: { x: -26, y: 27.5 },
        tags: ['đỗ xe', 'ô tô', 'gửi xe'],
      },
      {
        id: 'poi_bike_parking',
        name: 'Gửi xe máy',
        kind: 'bike',
        position: { x: -40, y: 60 },
        tags: ['xe máy', 'gửi xe', 'đỗ xe', 'xe đạp'],
      },
      {
        id: 'poi_taxi',
        name: 'Điểm đón taxi',
        kind: 'taxi',
        position: { x: -8.5, y: 70 },
        tags: ['taxi', 'xe công nghệ', 'đón khách'],
      },
      {
        id: 'poi_emergency',
        name: 'Cấp cứu 24/7',
        kind: 'emergency',
        position: { x: -2.5, y: 49.5 },
        tags: ['cấp cứu', 'khẩn cấp', 'emergency', '115'],
        description: 'Xe cấp cứu đi dốc màu đỏ lên Sảnh Cấp cứu',
      },
      {
        id: 'poi_security',
        name: 'Bốt bảo vệ',
        kind: 'security',
        position: { x: -23.5, y: 73.2 },
        tags: ['bảo vệ', 'an ninh'],
      },
    ],
  },
  links: [],
  version: 1,
  updatedAt: '2026-10-01T00:00:00.000Z',
});

/** Mặt bằng ngoài trời đầy đủ của cơ sở mẫu: khuôn viên + sảnh, làn đón, dốc của hai toà mẫu. */
export function createSampleSitePlan(): SitePlan {
  const buildings = new Map([createSampleBuilding(), createSampleAnnex()].map((b) => [b.id, b]));
  return campusSitePlan(createSampleCampus(), (id) => buildings.get(id)?.exterior)!;
}
