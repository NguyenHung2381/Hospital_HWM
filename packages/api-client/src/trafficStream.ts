import type { TrafficSnapshot } from '@hwn/map-core';
import type { TrafficStreamMessage } from './contract';

/**
 * - `connecting`: đang mở WebSocket lần đầu
 * - `live`: nhận dữ liệu qua WebSocket
 * - `polling`: WebSocket không dùng được → hỏi server định kỳ (vẫn thử kết nối lại WebSocket)
 * - `offline`: cả WebSocket lẫn polling đều lỗi
 */
export type TrafficStreamStatus = 'connecting' | 'live' | 'polling' | 'offline';

export interface TrafficStreamOptions {
  /** URL WebSocket tuyệt đối (ws:// hoặc wss://). */
  url: string;
  /** Lấy một ảnh chụp qua REST — dùng khi WebSocket không khả dụng. */
  poll: () => Promise<TrafficSnapshot>;
  onSnapshot: (snapshot: TrafficSnapshot) => void;
  onStatus?: (status: TrafficStreamStatus) => void;
  pollIntervalMs?: number;
  /** Thời gian chờ mở kết nối trước khi chuyển sang polling. */
  connectTimeoutMs?: number;
  /** Các mức chờ giữa những lần thử kết nối lại (lần cuối được lặp lại). */
  reconnectDelaysMs?: number[];
  /** Cho phép thay thế trong test. Bỏ trống = `globalThis.WebSocket` (không có thì chỉ polling). */
  WebSocketImpl?: typeof WebSocket;
}

export interface TrafficStream {
  close(): void;
}

/** Nhận lưu lượng realtime: ưu tiên WebSocket, tự kết nối lại, tự chuyển sang polling khi cần. */
export function createTrafficStream(options: TrafficStreamOptions): TrafficStream {
  const {
    url,
    poll,
    onSnapshot,
    onStatus,
    pollIntervalMs = 3000,
    connectTimeoutMs = 5000,
    reconnectDelaysMs = [1000, 2000, 5000, 10_000],
    WebSocketImpl = globalThis.WebSocket,
  } = options;

  let closed = false;
  let socket: WebSocket | null = null;
  let status: TrafficStreamStatus | null = null;
  let attempt = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;

  const setStatus = (next: TrafficStreamStatus) => {
    if (next === status || closed) return;
    status = next;
    onStatus?.(next);
  };

  const pollOnce = async () => {
    try {
      const snapshot = await poll();
      if (closed || status === 'live') return;
      onSnapshot(snapshot);
      setStatus('polling');
    } catch {
      if (!closed && status !== 'live') setStatus('offline');
    }
  };

  const startPolling = () => {
    if (pollTimer || closed) return;
    void pollOnce();
    pollTimer = setInterval(() => void pollOnce(), pollIntervalMs);
  };

  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer) return;
    const delay = reconnectDelaysMs[Math.min(attempt, reconnectDelaysMs.length - 1)] ?? 10_000;
    attempt++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const onDisconnected = () => {
    socket = null;
    if (connectTimer) clearTimeout(connectTimer);
    if (closed) return;
    // Rời trạng thái "live" ngay để kết quả polling không bị bỏ qua.
    if (status === 'live' || status === 'connecting') setStatus('polling');
    startPolling();
    scheduleReconnect();
  };

  function connect() {
    if (closed) return;
    if (!WebSocketImpl) {
      startPolling();
      return;
    }
    let ws: WebSocket;
    try {
      ws = new WebSocketImpl(url);
    } catch {
      onDisconnected();
      return;
    }
    socket = ws;
    // Một số máy chủ "treo" kết nối thay vì từ chối — đừng chờ mãi.
    connectTimer = setTimeout(() => {
      if (ws.readyState === WebSocketImpl.OPEN) return;
      ws.close();
      if (socket === ws) onDisconnected();
    }, connectTimeoutMs);

    ws.onopen = () => {
      if (connectTimer) clearTimeout(connectTimer);
      attempt = 0;
      stopPolling();
      setStatus('live');
    };
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as TrafficStreamMessage;
        if (message.type === 'snapshot') onSnapshot(message.data);
      } catch {
        // Bỏ qua thông điệp không hợp lệ.
      }
    };
    ws.onclose = () => {
      if (socket === ws) onDisconnected();
    };
    ws.onerror = () => ws.close();
  }

  setStatus('connecting');
  connect();

  return {
    close() {
      closed = true;
      stopPolling();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (connectTimer) clearTimeout(connectTimer);
      const ws = socket;
      socket = null;
      ws?.close();
    },
  };
}
