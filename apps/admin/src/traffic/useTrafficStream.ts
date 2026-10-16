import { useEffect, useState } from 'react';
import { createTrafficStream, type TrafficStreamStatus } from '@hwn/api-client';
import type { Id, TrafficSnapshot } from '@hwn/map-core';
import { api } from '../lib/api';

/** Giữ lại mẫu tổng số người trong khoảng này để vẽ biểu đồ "trực tiếp". */
export const LIVE_WINDOW_MS = 10 * 60_000;

export interface LiveSample {
  t: number;
  total: number;
}

export interface TrafficStreamState {
  snapshot: TrafficSnapshot | null;
  status: TrafficStreamStatus;
  samples: LiveSample[];
}

/** Lưu lượng realtime của toà nhà: WebSocket, tự chuyển sang polling khi cần. */
export function useTrafficStream(buildingId: Id | undefined): TrafficStreamState {
  const [state, setState] = useState<TrafficStreamState>({
    snapshot: null,
    status: 'connecting',
    samples: [],
  });

  useEffect(() => {
    if (!buildingId) return;
    const stream = createTrafficStream({
      url: api.traffic.streamUrl(buildingId),
      poll: () => api.traffic.snapshot(buildingId),
      onStatus: (status) => setState((s) => ({ ...s, status })),
      onSnapshot: (snapshot) =>
        setState((s) => {
          const t = Date.parse(snapshot.timestamp);
          const samples = [...s.samples, { t, total: snapshot.totalActive }].filter(
            (x) => x.t > t - LIVE_WINDOW_MS,
          );
          return { ...s, snapshot, samples };
        }),
    });
    return () => stream.close();
  }, [buildingId]);

  return state;
}
