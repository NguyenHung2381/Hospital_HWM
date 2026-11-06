import {
  buildingFootprint,
  mergeLobbies,
  nextPlacementPosition,
  type Building,
  type Campus,
  type Department,
  type Id,
  type Point,
} from '@hwn/map-core';
import {
  createLanPlanBuildings,
  createLanPlanCampus,
  createSampleAnnex,
  createSampleBuilding,
  createSampleCampus,
  SAMPLE_ANNEX_ID,
  SAMPLE_BUILDING_ID,
  SAMPLE_CAMPUS_ID,
  sampleDepartments,
} from '@hwn/map-core/sample';

/**
 * "Cơ sở dữ liệu" trong bộ nhớ của mock server.
 * Nếu chạy trong trình duyệt, dữ liệu được lưu vào localStorage để giữ lại thay đổi sau khi tải lại trang.
 * Lưu ý: localStorage tách biệt theo origin, nên app user (cổng 5173) và admin (cổng 5174)
 * có dữ liệu mock riêng — server thật sẽ không gặp vấn đề này.
 */
const STORAGE_KEY = 'hwn-mock-db-v1';

/**
 * Phiên bản dữ liệu mẫu đã nạp — tăng khi bổ sung dữ liệu mẫu mới cho db đã lưu từ trước.
 * 2: thêm toà mẫu thứ hai · 3: danh mục khoa toàn viện + cơ sở · 4: đường, lối đi, điểm ngoài trời
 * · 5: dốc lên sảnh, làn ô tô / xe máy, cổng xe máy · 6: hàng rào, đường chung có vỉa hè, giờ mở cổng
 * · 7: dốc cong liền với làn đón trả khách, ghi rõ dốc Cấp cứu / Khoa Khám bệnh, điểm Cấp cứu
 * · 8: dốc có lối đi bộ đi kèm · 9: dốc ngắn hơn, có chiều xe chạy (lên / xuống)
 * · 10: làn đón trả khách sát vỉa hè, sảnh rộng hơn
 * · 11: sảnh, làn đón, dốc chuyển thành phần ngoài trời của toà (`Building.exterior`)
 * · 12: sảnh + dốc gộp thành một đối tượng (`exterior.lobbies`), có bậc / dốc ở các cạnh.
 * · 13: cơ sở + các toà theo bộ bản vẽ LAN của bệnh viện (tầng có ảnh nền mặt bằng, chưa có phòng).
 * · 14: tường, cột, cửa trích từ bản vẽ LAN cho các tầng đó (tầng chưa vẽ gì).
 * · 15: trích lại (thêm tường bị sót, vách nét đơn, thang bộ / cuốn / máy, dốc) cho toà LAN chưa lưu.
 * · 16, 17: thang trong sân trong nhà chính LAN thành bậc từ sân lên tầng 1 (`exterior`), toà chưa
 *   lưu (17: chênh cao bậc theo mặc định, khớp bệ toà).
 * · 18: phần ngoài trời của cơ sở LAN theo sơ đồ tổng thể (nhà cầu, khu bể nước) khi còn trống.
 * · 19: chạy lại 13, 17, 18 cho dữ liệu đã đánh dấu 18 khi code còn đang sửa: thêm toà / cơ sở LAN
 *   còn thiếu, toà chưa lưu nhận bản trích mới nhất, ngoài trời LAN bổ sung khu vực / đường còn
 *   thiếu theo ID (giữ phần đã vẽ thêm).
 * · 20: bỏ cơ sở mẫu "Cơ sở chính" và hai toà mẫu — chỉ còn bệnh viện thật theo bản vẽ LAN.
 * · 21: trích lại toà LAN chưa lưu: tường nối qua cửa sổ, thang bộ bị sót, bỏ hộp kỹ thuật nhận
 *   nhầm thành thang máy, bậc tam cấp / dốc lối vào thành phần ngoài trời của toà.
 */
const SEED_VERSION = 21;

/** Cơ sở / toà dữ liệu mẫu (chỉ còn dùng trong test — `resetMockDb({ sample: true })`). */
const SAMPLE_BUILDING_IDS: Id[] = [SAMPLE_BUILDING_ID, SAMPLE_ANNEX_ID];

/**
 * Phần ngoài trời vẫn là bản mẫu (mọi khu vực / đường / cổng đều mang ID `site_…` của dữ liệu mẫu —
 * đối tượng vẽ thêm trong editor có ID khác) thì được thay bằng bản mẫu mới nhất.
 */
const isSampleSite = (site: Campus['site']) =>
  !!site && [...site.areas, ...site.paths, ...site.gates].every((x) => x.id.startsWith('site_'));

interface DbState {
  buildings: Record<Id, Building>;
  campuses?: Record<Id, Campus>;
  /** Danh mục khoa toàn viện — `building.departments` của mọi toà luôn trỏ tới mảng này. */
  departments?: Department[];
  seed?: number;
}

/** @param sample thêm cơ sở + hai toà mẫu (test của mock API dựa trên chúng). */
function initialState(sample = false): DbState {
  const plans = createLanPlanCampus();
  const buildings = createLanPlanBuildings();
  const campuses: Record<Id, Campus> = {};
  if (sample) {
    buildings.unshift(createSampleBuilding(), createSampleAnnex());
    const campus = createSampleCampus();
    campuses[campus.id] = campus;
  }
  campuses[plans.id] = plans;
  return {
    buildings: Object.fromEntries(buildings.map((b) => [b.id, b])),
    campuses,
    departments: structuredClone(sampleDepartments),
    seed: SEED_VERSION,
  };
}

/** Nâng cấp db lưu từ phiên bản cũ, giữ nguyên dữ liệu người dùng đã sửa. */
function upgrade(state: DbState): DbState {
  const seed = state.seed ?? 1;
  if (seed >= SEED_VERSION) return state;
  let next = { ...state };
  if (seed < 2) {
    const annex = createSampleAnnex();
    next.buildings = { ...next.buildings, [annex.id]: next.buildings[annex.id] ?? annex };
  }
  if (seed < 3) {
    // Khoa của các toà gộp thành một danh mục (trùng ID thì giữ bản đầu tiên).
    const departments = new Map<Id, Department>();
    for (const b of Object.values(next.buildings)) {
      for (const d of b.departments ?? []) if (!departments.has(d.id)) departments.set(d.id, d);
    }
    // Mọi toà đang có vào một cơ sở mặc định, xếp thành hàng ngang.
    const campus: Campus = { ...createSampleCampus(), buildings: [] };
    const footprints = new Map<Id, Point[]>();
    for (const b of Object.values(next.buildings)) {
      footprints.set(b.id, buildingFootprint(b));
      campus.buildings.push({
        buildingId: b.id,
        position: nextPlacementPosition(campus, footprints),
        rotation: 0,
      });
    }
    next = {
      ...next,
      departments: [...departments.values()],
      campuses: { [campus.id]: campus },
    };
  }
  if (seed < 4) {
    // Cơ sở mẫu chưa có phần ngoài trời: bổ sung từ dữ liệu mẫu (giữ vị trí toà đã chỉnh).
    const sample = createSampleCampus();
    const existing = next.campuses?.[sample.id];
    if (existing && !existing.site) {
      next.campuses = {
        ...next.campuses,
        [sample.id]: { ...existing, site: sample.site, links: existing.links ?? [] },
      };
    }
  }
  if (seed < 10) {
    // Bố cục ngoài trời mẫu mới — chỉ thay khi chưa vẽ thêm gì.
    const sample = createSampleCampus();
    const existing = next.campuses?.[sample.id];
    if (existing && isSampleSite(existing.site)) {
      next.campuses = { ...next.campuses, [sample.id]: { ...existing, site: sample.site } };
    }
  }
  if (seed < 11) {
    // Sảnh / dốc mẫu chuyển từ khuôn viên sang toà. Khuôn viên còn là bản mẫu thì thay bản mới và
    // gắn sảnh mẫu cho hai toà mẫu; khuôn viên đã sửa mà vẫn còn sảnh / dốc cũ thì giữ nguyên
    // (không gắn thêm để khỏi trùng).
    const sample = createSampleCampus();
    const existing = next.campuses?.[sample.id];
    const legacy = (c: Campus | undefined) =>
      !!c?.site &&
      [...c.site.areas, ...c.site.paths].some((x) => /^site_(lobby|dropoff|ramp)_/.test(x.id));
    if (existing && isSampleSite(existing.site)) {
      next.campuses = { ...next.campuses, [sample.id]: { ...existing, site: sample.site } };
    }
    if (!legacy(next.campuses?.[sample.id])) {
      const buildings = { ...next.buildings };
      for (const fresh of [createSampleBuilding(), createSampleAnnex()]) {
        const b = buildings[fresh.id];
        if (b && !b.exterior) buildings[fresh.id] = { ...b, exterior: fresh.exterior };
      }
      next.buildings = buildings;
    }
  }
  if (seed < 12) {
    // Sảnh, khu đón, làn đón, dốc rời (do công cụ Sảnh đón dựng, chưa sửa tay) gộp thành một sảnh.
    const buildings = { ...next.buildings };
    for (const b of Object.values(buildings)) {
      if (!b.exterior) continue;
      const merged = mergeLobbies(b.exterior, buildingFootprint(b));
      if (merged !== b.exterior) buildings[b.id] = { ...b, exterior: merged };
    }
    next.buildings = buildings;
  }
  if (seed < 13 || seed === 18) {
    // Toà / cơ sở theo bản vẽ LAN: chỉ thêm khi chưa có (giữ bản đã sửa).
    const plans = createLanPlanCampus();
    const buildings = { ...next.buildings };
    for (const b of createLanPlanBuildings()) buildings[b.id] ??= b;
    next.buildings = buildings;
    if (!next.campuses?.[plans.id]) next.campuses = { ...next.campuses, [plans.id]: plans };
  }
  if (seed < 14) {
    // Tầng theo bản vẽ LAN còn trống (chưa vẽ gì) thì nhận tường / cột / cửa trích từ bản vẽ.
    const buildings = { ...next.buildings };
    for (const fresh of createLanPlanBuildings()) {
      const b = buildings[fresh.id];
      if (!b) continue;
      const floors = b.floors.map((f) => {
        const src = fresh.floors.find((x) => x.id === f.id);
        const empty = !f.walls.length && !f.rooms.length && !f.openings.length;
        return src && empty ? { ...f, walls: src.walls, openings: src.openings } : f;
      });
      buildings[b.id] = { ...b, floors };
    }
    next.buildings = buildings;
  }
  if (seed < 21) {
    // Toà theo bản vẽ LAN chưa từng được lưu (version 1) thì thay bằng bản trích mới nhất.
    const buildings = { ...next.buildings };
    for (const fresh of createLanPlanBuildings()) {
      const b = buildings[fresh.id];
      if (b && b.version === 1) {
        buildings[b.id] = {
          ...b,
          floors: fresh.floors,
          ...(fresh.exterior ? { exterior: fresh.exterior } : {}),
        };
      }
    }
    next.buildings = buildings;
  }
  if (seed < 18) {
    // Cơ sở LAN chưa vẽ gì ngoài trời thì nhận nhà cầu, khu bể nước theo sơ đồ tổng thể.
    const plans = createLanPlanCampus();
    const c = next.campuses?.[plans.id];
    const empty = (s?: Campus['site']) =>
      !s || (!s.areas.length && !s.paths.length && !s.gates.length && !s.pois.length);
    if (c && empty(c.site))
      next.campuses = { ...next.campuses, [c.id]: { ...c, site: plans.site } };
  }
  if (seed === 18) {
    const plans = createLanPlanCampus();
    const c = next.campuses?.[plans.id];
    if (c && plans.site) {
      const site = c.site ?? { areas: [], paths: [], gates: [], pois: [] };
      const missing = <T extends { id: Id }>(have: T[], want: T[]) =>
        want.filter((w) => !have.some((h) => h.id === w.id));
      next.campuses = {
        ...next.campuses,
        [c.id]: {
          ...c,
          site: {
            ...site,
            areas: [...site.areas, ...missing(site.areas, plans.site.areas)],
            paths: [...site.paths, ...missing(site.paths, plans.site.paths)],
          },
        },
      };
    }
  }
  if (seed < 20) {
    // Bỏ dữ liệu mẫu. Toà người dùng tự thêm vào cơ sở mẫu thì giữ (cơ sở mẫu còn lại chỉ với các
    // toà đó); cơ sở mẫu không còn toà nào thì xoá hẳn.
    const buildings = { ...next.buildings };
    for (const id of SAMPLE_BUILDING_IDS) delete buildings[id];
    next.buildings = buildings;
    const campuses = { ...next.campuses };
    for (const c of Object.values(campuses)) {
      const kept = c.buildings.filter((pl) => !SAMPLE_BUILDING_IDS.includes(pl.buildingId));
      if (kept.length !== c.buildings.length) campuses[c.id] = { ...c, buildings: kept };
    }
    const sample = campuses[SAMPLE_CAMPUS_ID];
    if (sample && !sample.buildings.length) delete campuses[SAMPLE_CAMPUS_ID];
    next.campuses = campuses;
  }
  return { ...next, seed: SEED_VERSION };
}

/** Gắn danh mục khoa dùng chung vào mọi toà. */
function linkDepartments(state: DbState): DbState {
  const departments = state.departments ?? [];
  for (const b of Object.values(state.buildings)) b.departments = departments;
  return { ...state, departments, campuses: state.campuses ?? {} };
}

function load(): DbState {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) return linkDepartments(upgrade(JSON.parse(raw) as DbState));
  } catch {
    // Bỏ qua: localStorage không khả dụng hoặc dữ liệu hỏng.
  }
  return linkDepartments(initialState());
}

let state: DbState = load();

function persist() {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Bỏ qua: chế độ ẩn danh / hết dung lượng.
  }
}

const campuses = () => state.campuses!;

export const db = {
  listBuildings: (): Building[] => Object.values(state.buildings),
  getBuilding: (id: Id): Building | undefined => state.buildings[id],
  /** Ghi đè toàn bộ toà nhà (đã tăng version ở phía gọi). Khoa luôn lấy theo danh mục chung. */
  putBuilding(building: Building) {
    building.departments = db.departments();
    state.buildings[building.id] = building;
    persist();
  },
  removeBuilding(id: Id) {
    delete state.buildings[id];
    for (const c of Object.values(campuses())) {
      if (!c.buildings.some((pl) => pl.buildingId === id)) continue;
      c.buildings = c.buildings.filter((pl) => pl.buildingId !== id);
      bump(c);
    }
    persist();
  },
  /** Gọi sau khi sửa trực tiếp object trả về từ `getBuilding`. */
  touch(building: Building) {
    bump(building);
    persist();
  },

  /** Danh mục khoa toàn viện (mảng dùng chung — sửa trực tiếp rồi gọi `saveDepartments`). */
  departments: (): Department[] => state.departments!,
  saveDepartments() {
    persist();
  },

  listCampuses: (): Campus[] => Object.values(campuses()),
  getCampus: (id: Id): Campus | undefined => campuses()[id],
  /** Cơ sở chứa toà `buildingId`. */
  campusOf: (buildingId: Id): Campus | undefined =>
    db.listCampuses().find((c) => c.buildings.some((pl) => pl.buildingId === buildingId)),
  putCampus(campus: Campus) {
    campuses()[campus.id] = campus;
    persist();
  },
  removeCampus(id: Id) {
    delete campuses()[id];
    persist();
  },
  touchCampus(campus: Campus) {
    bump(campus);
    persist();
  },
};

function bump(doc: { version: number; updatedAt: string }) {
  doc.version += 1;
  doc.updatedAt = new Date().toISOString();
}

/**
 * Khôi phục dữ liệu ban đầu (gọi từ console: `window.__hwnMock.reset()`).
 * @param opts.sample kèm cơ sở + toà mẫu (cho test).
 */
export function resetMockDb(opts: { sample?: boolean } = {}) {
  state = linkDepartments(initialState(opts.sample));
  persist();
}
