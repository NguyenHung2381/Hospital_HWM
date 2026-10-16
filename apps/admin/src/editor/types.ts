import type {
  Connector,
  ConnectorType,
  Id,
  Landmark,
  Opening,
  OpeningType,
  Room,
  Wall,
} from '@hwn/map-core';

export type Tool =
  | 'select'
  | 'pan'
  | 'wall'
  | 'wallRect'
  | 'door'
  | 'window'
  | 'entrance'
  | 'elevator'
  | 'stairs'
  | 'escalator'
  | 'room'
  | 'roomAuto'
  | 'landmark'
  | 'navNode'
  | 'navEdge'
  | 'measure'
  | 'calibrate';

export const OPENING_TOOLS = {
  door: 'door',
  window: 'window',
  entrance: 'entrance',
} as const satisfies Partial<Record<Tool, OpeningType>>;

export const CONNECTOR_TOOLS = {
  elevator: 'elevator',
  stairs: 'stairs',
  escalator: 'escalator',
} as const satisfies Partial<Record<Tool, ConnectorType>>;

export const isOpeningTool = (t: Tool): t is keyof typeof OPENING_TOOLS => t in OPENING_TOOLS;
export const isConnectorTool = (t: Tool): t is keyof typeof CONNECTOR_TOOLS => t in CONNECTOR_TOOLS;

export type ItemType =
  'wall' | 'opening' | 'connector' | 'room' | 'landmark' | 'navNode' | 'navEdge';

/** Công cụ làm việc với đồ thị đi lại — khi dùng thì luôn hiện đồ thị. */
export const isNavTool = (t: Tool) => t === 'navNode' || t === 'navEdge';

export interface ItemRef {
  type: ItemType;
  id: Id;
}

export const sameRef = (a: ItemRef, b: ItemRef) => a.type === b.type && a.id === b.id;

export interface EndpointRef {
  wallId: Id;
  which: 'start' | 'end';
}

/** Nội dung clipboard khi copy. */
export interface Clipboard {
  sourceFloorId: Id;
  walls: Wall[];
  openings: Opening[];
  connectors: Connector[];
  rooms: Room[];
  landmarks: Landmark[];
}

export interface EditorSettings {
  /** Bước bắt dính lưới (m) — cũng là cạnh ô lưới nhỏ. 0 = tắt. */
  gridSize: number;
  /** Cạnh ô lưới lớn hiển thị (m) — đơn vị đo trên khung vẽ. 0 = ẩn lưới. */
  gridUnit: number;
  snapGrid: boolean;
  /** Ràng buộc góc 45° khi vẽ tường. */
  snapAngle: boolean;
  /** Bắt dính vào đầu mút / thân tường. */
  snapObjects: boolean;
  wallThickness: number;
  /** Công cụ tường chữ nhật tạo luôn phòng bên trong. */
  rectWithRoom: boolean;
  showNavGraph: boolean;
  showBackground: boolean;
  show3d: boolean;
}

/** Các lựa chọn cạnh ô lưới lớn (m). */
export const GRID_UNITS = [0.5, 1, 2, 5, 10] as const;

export const DEFAULT_SETTINGS: EditorSettings = {
  gridSize: 0.5,
  gridUnit: 1,
  snapGrid: true,
  snapAngle: true,
  snapObjects: true,
  wallThickness: 0.2,
  rectWithRoom: true,
  showNavGraph: false,
  showBackground: true,
  show3d: false,
};
