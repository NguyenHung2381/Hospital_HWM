/**
 * Dữ liệu mẫu: toà nhà 2 tầng, mỗi tầng 40 m x 20 m.
 *
 *   y=0  ┌─────────┬─────────┬─────────┬────┬────┐
 *        │  top0   │  top1   │  top2   │ TB │ TM │   TB = thang bộ, TM = thang máy
 *   y=8  ├──┤ ├────┴──┤ ├────┴──┤ ├────┴┤ ├┴─┤ ├┤
 *        ⇥            hành lang (y = 10)          │   ⇥ = cửa chính (chỉ tầng 1)
 *   y=12 ├──┤ ├────┬──┤ ├────┬──┤ ├────┬──┤ ├────┤
 *        │  bot0   │  bot1   │  bot2   │  bot3   │
 *   y=20 └─────────┴─────────┴─────────┴─────────┘
 *        x=0      10        20        30        40
 *
 * Trước cửa chính (phía tây, x < 0) là cụm sảnh đón của toà (`exterior`): sảnh, làn đón trả khách,
 * dốc lên / dốc xuống — chân dốc cách tường 13.75 m, rơi vào làn xe của đường nội bộ khuôn viên.
 */
import type {
  Building,
  Connector,
  Department,
  Floor,
  Landmark,
  NavEdge,
  NavNode,
  Opening,
  Point,
  Room,
  Wall,
} from '../types';

export const SAMPLE_BUILDING_ID = 'bld_hwn_demo';

const WIDTH = 40;
const HEIGHT = 20;
const CORRIDOR_TOP = 8;
const CORRIDOR_BOTTOM = 12;
const CORRIDOR_Y = (CORRIDOR_TOP + CORRIDOR_BOTTOM) / 2;
const FLOOR_HEIGHT = 3.6;

export const sampleDepartments: Department[] = [
  { id: 'dept_kkb', name: 'Khoa Khám bệnh', code: 'KKB', color: '#3b82f6' },
  { id: 'dept_xn', name: 'Khoa Xét nghiệm', code: 'XN', color: '#10b981' },
  { id: 'dept_cdha', name: 'Khoa Chẩn đoán hình ảnh', code: 'CĐHA', color: '#f59e0b' },
  { id: 'dept_nhi', name: 'Khoa Nhi', code: 'NHI', color: '#ec4899' },
  { id: 'dept_hc', name: 'Phòng Hành chính – Tài chính', code: 'HC', color: '#6b7280' },
];

interface RoomSpec {
  name: string;
  code: string;
  departmentId: string | null;
  tags?: string[];
  /** Độ rộng cửa phòng (m), mặc định 1.2. */
  doorWidth?: number;
  /**
   * Điểm đích đến trong phòng (bàn khám, quầy…). Mặc định: lệch 2.5 m sang phải cửa, cách tường
   * trong cùng 2.5 m. `null` = không đặt (tuyến kết thúc ở giữa phòng).
   */
  destination?: Point | null;
}

interface FloorSpec {
  id: string;
  name: string;
  level: number;
  /** 3 phòng dãy trên (x 0–30). */
  top: [RoomSpec, RoomSpec, RoomSpec];
  /** 4 phòng dãy dưới (x 0–40). */
  bottom: [RoomSpec, RoomSpec, RoomSpec, RoomSpec];
  hasMainEntrance: boolean;
  landmarks?: Landmark[];
}

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

function buildFloor(spec: FloorSpec): Floor {
  const p = spec.id;
  const walls: Wall[] = [];
  const openings: Opening[] = [];
  const connectors: Connector[] = [];
  const rooms: Room[] = [];
  const nodes: NavNode[] = [];
  const edges: NavEdge[] = [];

  const wall = (name: string, start: Point, end: Point, thickness: number) => {
    const w: Wall = { id: `${p}_wall_${name}`, start, end, thickness, height: FLOOR_HEIGHT };
    walls.push(w);
    return w;
  };
  const opening = (
    name: string,
    type: Opening['type'],
    wallId: string,
    offset: number,
    width: number,
  ) => {
    const o: Opening =
      type === 'window'
        ? { id: `${p}_win_${name}`, type, wallId, offset, width, height: 1.4, sillHeight: 0.9 }
        : { id: `${p}_door_${name}`, type, wallId, offset, width, height: 2.2, sillHeight: 0 };
    openings.push(o);
    return o;
  };
  const node = (id: string, kind: NavNode['kind'], position: Point, refId?: string) => {
    const n: NavNode = { id: `${p}_n_${id}`, kind, position, refId };
    nodes.push(n);
    return n;
  };
  const edge = (a: NavNode, b: NavNode) =>
    edges.push({
      id: `${p}_e_${a.id.slice(p.length + 3)}__${b.id.slice(p.length + 3)}`,
      from: a.id,
      to: b.id,
    });

  // Tường bao & tường hành lang.
  const extN = wall('ext_n', { x: 0, y: 0 }, { x: WIDTH, y: 0 }, 0.3);
  const extE = wall('ext_e', { x: WIDTH, y: 0 }, { x: WIDTH, y: HEIGHT }, 0.3);
  const extS = wall('ext_s', { x: 0, y: HEIGHT }, { x: WIDTH, y: HEIGHT }, 0.3);
  const extW = wall('ext_w', { x: 0, y: 0 }, { x: 0, y: HEIGHT }, 0.3);
  const corN = wall('cor_n', { x: 0, y: CORRIDOR_TOP }, { x: WIDTH, y: CORRIDOR_TOP }, 0.2);
  const corS = wall('cor_s', { x: 0, y: CORRIDOR_BOTTOM }, { x: WIDTH, y: CORRIDOR_BOTTOM }, 0.2);
  for (const x of [10, 20, 30, 35]) wall(`top_${x}`, { x, y: 0 }, { x, y: CORRIDOR_TOP }, 0.15);
  for (const x of [10, 20, 30]) wall(`bot_${x}`, { x, y: CORRIDOR_BOTTOM }, { x, y: HEIGHT }, 0.15);

  // Cửa sổ.
  for (const x of [5, 15, 25]) opening(`n_${x}`, 'window', extN.id, x, 2);
  for (const x of [5, 15, 25, 35]) opening(`s_${x}`, 'window', extS.id, x, 2);
  opening('e', 'window', extE.id, CORRIDOR_Y, 1.5);

  // Nút hành lang (y = CORRIDOR_Y), nối thành chuỗi theo x.
  const corridorXs = [5, 15, 25, 32.5, 35, 37.5];
  const corridor = new Map(
    corridorXs.map((x) => [x, node(`c_${x}`, 'corridor', { x, y: CORRIDOR_Y })]),
  );
  for (let i = 1; i < corridorXs.length; i++) {
    edge(corridor.get(corridorXs[i - 1]!)!, corridor.get(corridorXs[i]!)!);
  }

  // Cửa chính hoặc cửa sổ ở đầu hồi phía tây.
  if (spec.hasMainEntrance) {
    const entrance = opening('main', 'entrance', extW.id, CORRIDOR_Y, 2.4);
    edge(node('entrance', 'entrance', { x: 0.5, y: CORRIDOR_Y }, entrance.id), corridor.get(5)!);
  } else {
    opening('w', 'window', extW.id, CORRIDOR_Y, 1.5);
  }

  /** Phòng/thang có cửa mở ra hành lang tại `x`: tạo cửa + nút cửa + nút bên trong. */
  const connectToCorridor = (
    name: string,
    corridorWall: Wall,
    x: number,
    doorWidth: number,
    inside: { kind: NavNode['kind']; position: Point; refId: string },
  ) => {
    const door = opening(name, 'door', corridorWall.id, x, doorWidth);
    const doorNode = node(`d_${name}`, 'door', { x, y: corridorWall.start.y }, door.id);
    const insideNode = node(name, inside.kind, inside.position, inside.refId);
    edge(corridor.get(x)!, doorNode);
    edge(doorNode, insideNode);
  };

  const addRoom = (
    slot: string,
    s: RoomSpec,
    polygon: Point[],
    corridorWall: Wall,
    doorX: number,
    insideY: number,
  ) => {
    const top = insideY < CORRIDOR_TOP;
    const destination =
      s.destination === undefined
        ? { x: doorX + 2.5, y: top ? 2.5 : HEIGHT - 2.5 }
        : (s.destination ?? undefined);
    const room: Room = {
      id: `${p}_room_${slot}`,
      name: s.name,
      code: s.code,
      polygon,
      departmentId: s.departmentId,
      tags: s.tags ?? [],
      ...(destination ? { destination } : {}),
    };
    rooms.push(room);
    // Nút phòng đặt tại điểm đích (giống khi tự sinh đồ thị trong editor).
    connectToCorridor(slot, corridorWall, doorX, s.doorWidth ?? 1.2, {
      kind: 'room',
      position: destination ?? { x: doorX, y: insideY },
      refId: room.id,
    });
  };

  spec.top.forEach((s, i) =>
    addRoom(`top${i}`, s, rect(i * 10, 0, i * 10 + 10, CORRIDOR_TOP), corN, i * 10 + 5, 4),
  );
  spec.bottom.forEach((s, i) =>
    addRoom(`bot${i}`, s, rect(i * 10, CORRIDOR_BOTTOM, i * 10 + 10, HEIGHT), corS, i * 10 + 5, 16),
  );

  // Thang bộ & thang máy.
  const stairs: Connector = {
    id: `${p}_conn_stairs_a`,
    type: 'stairs',
    name: 'Thang bộ A',
    polygon: rect(30.3, 0.3, 34.7, CORRIDOR_TOP - 0.3),
    linkId: 'link_stairs_a',
    direction: 'both',
  };
  const elevator: Connector = {
    id: `${p}_conn_elevator_a`,
    type: 'elevator',
    name: 'Thang máy A',
    polygon: rect(35.3, 3, 39.7, CORRIDOR_TOP - 0.3),
    linkId: 'link_elevator_a',
    direction: 'both',
  };
  connectors.push(stairs, elevator);
  connectToCorridor('stairs_a', corN, 32.5, 1.5, {
    kind: 'connector',
    position: { x: 32.5, y: 4 },
    refId: stairs.id,
  });
  connectToCorridor('elevator_a', corN, 37.5, 1.2, {
    kind: 'connector',
    position: { x: 37.5, y: 5.4 },
    refId: elevator.id,
  });

  return {
    id: spec.id,
    name: spec.name,
    level: spec.level,
    elevation: (spec.level - 1) * FLOOR_HEIGHT,
    height: FLOOR_HEIGHT,
    walls,
    openings,
    connectors,
    rooms,
    landmarks: spec.landmarks ?? [],
    navGraph: { nodes, edges },
  };
}

const floor1 = buildFloor({
  id: 'floor_1',
  name: 'Tầng 1',
  level: 1,
  hasMainEntrance: true,
  landmarks: [
    {
      id: 'lm_kiosk_1',
      name: 'Máy lấy số thứ tự',
      kind: 'kiosk',
      position: { x: 3, y: 17.5 },
      tags: ['lấy số', 'số thứ tự'],
    },
    {
      id: 'lm_info_1',
      name: 'Quầy hướng dẫn',
      kind: 'info',
      position: { x: 8, y: 9 },
      tags: ['hỏi đường', 'hướng dẫn'],
    },
    {
      id: 'lm_atm_1',
      name: 'Cây ATM',
      kind: 'atm',
      position: { x: 38, y: 11 },
      tags: ['rút tiền'],
    },
  ],
  top: [
    {
      name: 'Phòng khám Nội tổng quát',
      code: 'P.101',
      departmentId: 'dept_kkb',
      tags: ['nội', 'khám'],
    },
    {
      name: 'Phòng khám Tai Mũi Họng',
      code: 'P.102',
      departmentId: 'dept_kkb',
      tags: ['tmh', 'tai mũi họng'],
    },
    {
      name: 'Phòng khám Răng Hàm Mặt',
      code: 'P.103',
      departmentId: 'dept_kkb',
      tags: ['rhm', 'nha khoa', 'răng'],
    },
  ],
  bottom: [
    {
      name: 'Sảnh tiếp đón',
      code: 'S.1',
      departmentId: 'dept_hc',
      tags: ['tiếp đón', 'lấy số', 'đăng ký'],
      doorWidth: 3,
    },
    {
      name: 'Phòng lấy mẫu xét nghiệm',
      code: 'P.105',
      departmentId: 'dept_xn',
      tags: ['lấy máu', 'lấy mẫu'],
    },
    {
      name: 'Phòng xét nghiệm Huyết học',
      code: 'P.106',
      departmentId: 'dept_xn',
      tags: ['máu', 'huyết học'],
    },
    {
      name: 'Quầy thu ngân',
      code: 'P.107',
      departmentId: 'dept_hc',
      tags: ['thanh toán', 'viện phí', 'thu ngân'],
    },
  ],
});

const floor2 = buildFloor({
  id: 'floor_2',
  name: 'Tầng 2',
  level: 2,
  hasMainEntrance: false,
  landmarks: [
    {
      id: 'lm_water_2',
      name: 'Máy nước uống',
      kind: 'water',
      position: { x: 22, y: 9 },
      tags: ['nước'],
    },
    {
      id: 'lm_waiting_2',
      name: 'Khu chờ chẩn đoán hình ảnh',
      kind: 'waiting',
      position: { x: 12, y: 11 },
      tags: ['ghế chờ'],
    },
  ],
  top: [
    { name: 'Phòng Siêu âm', code: 'P.201', departmentId: 'dept_cdha', tags: ['siêu âm'] },
    {
      name: 'Phòng X-quang',
      code: 'P.202',
      departmentId: 'dept_cdha',
      tags: ['x quang', 'chụp phim'],
    },
    { name: 'Phòng chụp CT', code: 'P.203', departmentId: 'dept_cdha', tags: ['ct', 'cắt lớp'] },
  ],
  bottom: [
    { name: 'Phòng khám Nhi', code: 'P.204', departmentId: 'dept_nhi', tags: ['trẻ em', 'nhi'] },
    {
      name: 'Phòng tiêm chủng',
      code: 'P.205',
      departmentId: 'dept_nhi',
      tags: ['tiêm', 'vắc xin'],
    },
    { name: 'Phòng khám Tim mạch', code: 'P.206', departmentId: 'dept_kkb', tags: ['tim'] },
    {
      name: 'Nhà vệ sinh',
      code: 'WC.2',
      departmentId: null,
      tags: ['wc', 'toilet', 'vệ sinh'],
      destination: null,
    },
  ],
});

export const sampleBuilding: Building = {
  id: SAMPLE_BUILDING_ID,
  name: 'Bệnh viện HWN (dữ liệu mẫu)',
  address: '123 Đường Mẫu, Quận 1, TP. HCM',
  floors: [floor1, floor2],
  departments: sampleDepartments,
  exterior: {
    areas: [],
    paths: [],
    lobbies: [
      {
        id: 'ext_main',
        name: 'Sảnh Khoa Khám bệnh',
        use: 'outpatient',
        position: { x: 0, y: CORRIDOR_Y },
        outward: { x: -1, y: 0 },
        width: 14,
        depth: 7,
        dropoff: { walkway: true },
      },
    ],
  },
  version: 1,
  updatedAt: '2026-10-01T00:00:00.000Z',
};

/** Tạo bản sao độc lập của dữ liệu mẫu (để mock server có thể sửa thoải mái). */
export const createSampleBuilding = (): Building => structuredClone(sampleBuilding);

export { createSampleAnnex, SAMPLE_ANNEX_ID } from './annex';
export { createSampleCampus, createSampleSitePlan, SAMPLE_CAMPUS_ID } from './campus';
export {
  createLanPlanBuildings,
  createLanPlanCampus,
  LAN_CAMPUS_ID,
  PLAN_IMAGE_BASE,
} from './lanPlans';
