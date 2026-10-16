import { lerp, nearestRoom, type Floor, type Id, type Point } from '@hwn/map-core';

export interface EdgeInfo {
  floor: Floor;
  edgeId: Id;
  a: Point;
  b: Point;
  mid: Point;
  /** Mô tả vị trí dễ hiểu, vd. "Hành lang gần P.102 – Phòng khám Tai Mũi Họng". */
  place: string;
}

/** Vị trí & mô tả của một cạnh đồ thị đi lại (dùng cho bảng & tooltip). */
export function describeEdge(floor: Floor, edgeId: Id): EdgeInfo | null {
  const e = floor.navGraph.edges.find((x) => x.id === edgeId);
  const a = e && floor.navGraph.nodes.find((n) => n.id === e.from);
  const b = e && floor.navGraph.nodes.find((n) => n.id === e.to);
  if (!a || !b) return null;
  const mid = lerp(a.position, b.position, 0.5);

  const connectorNode = [a, b].find((n) => n.kind === 'connector');
  const connector = connectorNode && floor.connectors.find((c) => c.id === connectorNode.refId);
  const entrance = [a, b].some((n) => n.kind === 'entrance');
  const near = nearestRoom(floor, mid, 6);
  const roomLabel = near ? [near.room.code, near.room.name].filter(Boolean).join(' – ') : '';

  const place = connector
    ? `Lối vào ${connector.name}`
    : entrance
      ? 'Khu cửa ra vào chính'
      : near?.inside
        ? `Trong ${roomLabel}`
        : near
          ? `Hành lang gần ${roomLabel}`
          : 'Hành lang';
  return { floor, edgeId, a: a.position, b: b.position, mid, place };
}
