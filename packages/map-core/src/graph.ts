/**
 * Đồ thị có trọng số dùng chung cho tìm đường trong toà (`navigation.ts`) và liên toà
 * (`campusRoute.ts`): hàng đợi ưu tiên và Dijkstra một nguồn.
 */

/** Hàng đợi ưu tiên nhỏ nhất (binary heap). */
export class MinHeap<T> {
  private items: { priority: number; value: T }[] = [];

  get size() {
    return this.items.length;
  }

  push(value: T, priority: number) {
    const items = this.items;
    items.push({ priority, value });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent]!.priority <= items[i]!.priority) break;
      [items[parent], items[i]] = [items[i]!, items[parent]!];
      i = parent;
    }
  }

  pop(): { priority: number; value: T } | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0 && last) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && items[l]!.priority < items[m]!.priority) m = l;
        if (r < items.length && items[r]!.priority < items[m]!.priority) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i]!, items[m]!];
        i = m;
      }
    }
    return top;
  }
}

/** Cung có hướng tới nút `to` với chi phí `cost` (≥ 0). */
export interface WeightedArc {
  to: string;
  cost: number;
}

export interface ShortestPathTree<A extends WeightedArc> {
  /** Chi phí nhỏ nhất đã biết tới từng nút (chính xác với các nút đã được "chốt"). */
  dist: Map<string, number>;
  /** Cung cuối cùng trên đường ngắn nhất tới từng nút. */
  prev: Map<string, { from: string; arc: A }>;
  /** Các nút đã chốt (chi phí trong `dist` là nhỏ nhất). */
  settled: Set<string>;
}

/**
 * Dijkstra một nguồn trên đồ thị cho bởi hàm `neighbors`.
 * @param onSettle gọi mỗi khi một nút được chốt; trả về true để dừng sớm (vd. đã tới mọi đích).
 */
export function dijkstra<A extends WeightedArc>(
  start: string,
  neighbors: (key: string) => readonly A[],
  onSettle?: (key: string, cost: number) => boolean | void,
): ShortestPathTree<A> {
  const dist = new Map<string, number>([[start, 0]]);
  const prev = new Map<string, { from: string; arc: A }>();
  const settled = new Set<string>();
  const heap = new MinHeap<string>();
  heap.push(start, 0);

  while (heap.size) {
    const { priority, value: u } = heap.pop()!;
    if (settled.has(u) || priority > (dist.get(u) ?? Infinity)) continue;
    settled.add(u);
    if (onSettle?.(u, priority)) break;
    for (const arc of neighbors(u)) {
      if (settled.has(arc.to)) continue;
      const nd = priority + arc.cost;
      if (nd < (dist.get(arc.to) ?? Infinity)) {
        dist.set(arc.to, nd);
        prev.set(arc.to, { from: u, arc });
        heap.push(arc.to, nd);
      }
    }
  }
  return { dist, prev, settled };
}

export interface PathStep<A> {
  key: string;
  /** Cung dùng để đi tới nút này (undefined với nút đầu). */
  via?: A;
}

/** Đường đi từ gốc cây tới `goal` (null nếu `goal` chưa được chốt). */
export function pathTo<A extends WeightedArc>(
  tree: ShortestPathTree<A>,
  goal: string,
): PathStep<A>[] | null {
  if (!tree.settled.has(goal)) return null;
  const path: PathStep<A>[] = [];
  let cur: string | undefined = goal;
  while (cur !== undefined) {
    const p = tree.prev.get(cur);
    path.push({ key: cur, via: p?.arc });
    cur = p?.from;
  }
  return path.reverse();
}
