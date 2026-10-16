/**
 * Toà mẫu thứ hai ("Khu B – Nội trú") để thử chế độ nhiều toà nhà.
 * Dựng lại từ mặt bằng của toà mẫu chính nhưng đổi toàn bộ ID (ID tầng, phòng, thang… phải
 * duy nhất trên toàn hệ thống) và đổi tên phòng.
 */
import type { Building, Floor, Id } from '../types';
import { sampleBuilding } from './index';

export const SAMPLE_ANNEX_ID = 'bld_hwn_annex';

/** Tên mới theo mã phòng cũ; phòng không có trong bảng giữ nguyên tên. */
const ROOM_NAMES: Record<string, { name: string; code: string; tags: string[] }> = {
  'P.101': { name: 'Buồng bệnh Nội 1', code: 'B.101', tags: ['nội trú', 'buồng bệnh'] },
  'P.102': { name: 'Buồng bệnh Nội 2', code: 'B.102', tags: ['nội trú', 'buồng bệnh'] },
  'P.103': { name: 'Phòng trực điều dưỡng', code: 'B.103', tags: ['điều dưỡng', 'trực'] },
  'S.1': { name: 'Sảnh Khu B', code: 'B.S1', tags: ['sảnh', 'tiếp đón'] },
  'P.105': { name: 'Phòng thay băng', code: 'B.105', tags: ['thủ thuật'] },
  'P.106': { name: 'Phòng hồi sức', code: 'B.106', tags: ['hồi sức', 'icu'] },
  'P.107': { name: 'Quầy làm thủ tục nhập viện', code: 'B.107', tags: ['nhập viện', 'thủ tục'] },
};

const remapFloor = (floor: Floor, id: (old: Id) => Id): Floor => ({
  ...floor,
  id: id(floor.id),
  walls: floor.walls.map((w) => ({ ...w, id: id(w.id) })),
  openings: floor.openings.map((o) => ({ ...o, id: id(o.id), wallId: id(o.wallId) })),
  connectors: floor.connectors.map((c) => ({
    ...c,
    id: id(c.id),
    linkId: id(c.linkId),
    name: c.name.replace(/ A$/, ' B'),
  })),
  rooms: floor.rooms.map((r) => {
    const renamed = ROOM_NAMES[r.code];
    return {
      ...r,
      id: id(r.id),
      ...(renamed ?? { code: r.code.replace(/^P\./, 'B.') }),
    };
  }),
  landmarks: floor.landmarks?.map((l) => ({ ...l, id: id(l.id) })),
  navGraph: {
    nodes: floor.navGraph.nodes.map((n) => ({
      ...n,
      id: id(n.id),
      refId: n.refId && id(n.refId),
    })),
    edges: floor.navGraph.edges.map((e) => ({
      ...e,
      id: id(e.id),
      from: id(e.from),
      to: id(e.to),
    })),
  },
});

export function createSampleAnnex(): Building {
  const src = structuredClone(sampleBuilding);
  const id = (old: Id) => `b_${old}`;
  return {
    ...src,
    id: SAMPLE_ANNEX_ID,
    name: 'Khu B – Nội trú (dữ liệu mẫu)',
    address: '125 Đường Mẫu, Quận 1, TP. HCM',
    floors: src.floors.map((f) => remapFloor(f, id)),
    // Khu B nhận bệnh nhân cấp cứu: sảnh và dốc màu đỏ, cùng vị trí cửa chính với toà chính.
    exterior: {
      areas: [],
      paths: [],
      lobbies: [
        {
          id: 'ext_annex',
          name: 'Sảnh Cấp cứu',
          use: 'emergency',
          position: { x: 0, y: 10 },
          outward: { x: -1, y: 0 },
          width: 14,
          depth: 7,
          dropoff: { walkway: true },
        },
      ],
    },
  };
}
