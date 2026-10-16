import Konva from 'konva';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from 'react';
import { Group, Stage } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { boundsOf, distance, rotatePoint, type BBox, type Point } from '@hwn/map-core';
import { useElementSize } from '../core/hooks';
import {
  centeredView,
  clamp,
  fitTransform,
  rotateAt,
  screenToWorld,
  zoomAt,
  type ViewTransform,
} from '../core/viewport';

// Cho phép nhận sự kiện chạm thứ 2 (pinch) khi đang kéo stage.
Konva.hitOnDragEnabled = true;
// Konva chỉ có cài đặt nút kéo TOÀN CỤC: cho phép chuột trái + giữa, rồi mỗi MapStage tự lọc
// theo prop `panButtons` trong handleDragStart.
Konva.dragButtons = [0, 1];

/** Nút chuột (MouseEvent.button) -> bit tương ứng trong MouseEvent.buttons. */
const BUTTON_MASK: Record<number, number> = { 0: 1, 1: 4, 2: 2 };

export interface MapStageHandle {
  /** Căn toàn bộ bản đồ vừa khung nhìn. */
  fit(): void;
  zoomBy(factor: number): void;
  /** Căn vùng `bounds` (m) vào giữa khung nhìn, chừa lề `padding` px (vẫn giới hạn theo min/maxScale). */
  fitBounds(bounds: BBox, padding?: number): void;
  /** Đưa điểm thế giới `p` về giữa khung nhìn (tuỳ chọn đổi tỉ lệ). */
  centerOn(p: Point, scale?: number): void;
  /** Dịch khung nhìn `dx`, `dy` pixel màn hình (dương = nội dung trôi sang phải / xuống dưới). */
  panBy(dx: number, dy: number): void;
  getTransform(): ViewTransform;
}

export interface MapStageProps {
  /** Vùng cần hiển thị khi căn khung. */
  bounds: BBox | null;
  /** Khi giá trị này đổi, khung nhìn được căn lại. Mặc định là `bounds`. */
  fitKey?: unknown;
  padding?: number;
  /**
   * Vùng (m) cần đưa vào giữa khung nhìn, vd. bước chỉ đường đang xem. Mỗi khi vùng này đổi,
   * khung nhìn trượt mượt tới đó; khi căn lại khung (đổi `fitKey`) cũng ưu tiên vùng này.
   */
  focus?: BBox | null;
  /** Lề (px) quanh vùng `focus`. */
  focusPadding?: number;
  /**
   * Góc xoay bản đồ (độ, theo chiều kim đồng hồ), vd. xoay theo la bàn. Khi đổi, bản đồ xoay quanh
   * tâm khung nhìn. Mặc định 0.
   */
  rotation?: number;
  /** Giới hạn zoom (pixel / mét). */
  minScale?: number;
  maxScale?: number;
  background?: string;
  /** Nút chuột dùng để kéo (pan) bản đồ: 0 = trái, 1 = giữa, 2 = phải. Mặc định [0]. */
  panButtons?: number[];
  onWorldClick?: (p: Point) => void;
  /** `evt` có khi con trỏ di chuyển trên bản đồ (không có khi rời khỏi bản đồ). */
  onWorldPointerMove?: (p: Point | null, evt?: PointerEvent) => void;
  onWorldPointerDown?: (p: Point, evt: PointerEvent) => void;
  onWorldPointerUp?: (p: Point, evt: PointerEvent) => void;
  onWorldDblClick?: (p: Point) => void;
  /** Con trỏ chuột trên bản đồ. */
  cursor?: string;
  /** Các Konva Layer, vẽ theo toạ độ thế giới (mét). */
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<MapStageHandle>;
}

interface ViewportValue {
  /** Pixel trên mỗi mét ở mức zoom hiện tại. */
  scale: number;
  /** Góc xoay bản đồ (độ). */
  rotation: number;
  /** Vùng thế giới (m) đang nhìn thấy. */
  rect: BBox;
}

const ViewportContext = createContext<ViewportValue>({
  scale: 1,
  rotation: 0,
  rect: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
});

/** Quy đổi kích thước pixel trên màn hình sang mét ở mức zoom hiện tại. */
export function usePx(): (px: number) => number {
  const { scale } = useContext(ViewportContext);
  return useCallback((px: number) => px / scale, [scale]);
}

export const useViewportScale = () => useContext(ViewportContext).scale;

/** Góc xoay bản đồ (độ) — nhãn/biểu tượng xoay ngược lại góc này để luôn đứng thẳng. */
export const useViewportRotation = () => useContext(ViewportContext).rotation;

/** Vùng thế giới (m) đang hiển thị — dùng để chỉ vẽ phần nhìn thấy (vd. lưới). */
export const useViewRect = () => useContext(ViewportContext).rect;

/** Phép đặt hệ trục con: gốc tại `position`, xoay `rotation` độ (chiều kim đồng hồ). */
export interface FrameTransform {
  position: Point;
  rotation: number;
}

const ORIGIN = { x: 0, y: 0 };

/** Phép đặt ngược: hệ trục cha nhìn từ hệ trục con. */
export const invertFrame = (f: FrameTransform): FrameTransform => ({
  position: rotatePoint({ x: -f.position.x, y: -f.position.y }, ORIGIN, -f.rotation),
  rotation: -f.rotation,
});

/**
 * Nhóm Konva vẽ theo một hệ trục con (vd. một toà đặt trên mặt bằng tổng thể, hoặc mặt bằng tổng
 * thể nhìn từ hệ trục của toà). Các lớp con vẫn dùng được `usePx`, nhãn vẫn đứng thẳng, lưới chỉ
 * vẽ phần nhìn thấy — vì vùng nhìn và góc xoay được quy đổi sang hệ trục con.
 */
export function LocalFrame({
  frame,
  opacity,
  children,
}: {
  frame: FrameTransform;
  opacity?: number;
  children: ReactNode;
}) {
  const parent = useContext(ViewportContext);
  const { position, rotation } = frame;
  const value = useMemo<ViewportValue>(() => {
    const r = parent.rect;
    const toLocal = (p: Point) =>
      rotatePoint({ x: p.x - position.x, y: p.y - position.y }, ORIGIN, -rotation);
    return {
      scale: parent.scale,
      rotation: parent.rotation + rotation,
      rect: boundsOf(
        [
          { x: r.minX, y: r.minY },
          { x: r.maxX, y: r.minY },
          { x: r.maxX, y: r.maxY },
          { x: r.minX, y: r.maxY },
        ].map(toLocal),
      )!,
    };
  }, [parent, position.x, position.y, rotation]);
  return (
    <Group x={position.x} y={position.y} rotation={rotation} opacity={opacity}>
      <ViewportContext.Provider value={value}>{children}</ViewportContext.Provider>
    </Group>
  );
}

const WHEEL_SENSITIVITY = 0.0015;
/** Thời lượng trượt khung nhìn tới vùng `focus` (ms). */
const GLIDE_MS = 650;
const lerpNum = (a: number, b: number, t: number) => a + (b - a) * t;

export function MapStage({
  bounds,
  fitKey,
  padding = 24,
  focus,
  focusPadding = 56,
  rotation = 0,
  minScale = 1,
  maxScale = 400,
  background,
  panButtons = [0],
  onWorldClick,
  onWorldPointerMove,
  onWorldPointerDown,
  onWorldPointerUp,
  onWorldDblClick,
  cursor,
  children,
  className,
  style,
  ref,
}: MapStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const size = useElementSize(containerRef);
  const [view, setView] = useState<ViewTransform>({ x: 0, y: 0, scale: 1, rotation });
  const screenCenter = { x: size.width / 2, y: size.height / 2 };

  const clampScale = useCallback((s: number) => clamp(s, minScale, maxScale), [minScale, maxScale]);

  /** Biến đổi đưa vùng `b` vào giữa khung, chừa lề `pad` px (vẫn giới hạn theo min/maxScale). */
  const centeredTransform = (b: BBox, pad: number): ViewTransform => {
    const s = clampScale(fitTransform(b, size.width, size.height, pad, rotation).scale);
    const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    return centeredView(c, s, rotation, size.width, size.height);
  };

  // Căn khung khi fitKey hoặc kích thước khung đổi (điều chỉnh state ngay trong render,
  // theo khuyến nghị của React thay vì dùng effect).
  const key = fitKey === undefined ? bounds : fitKey;
  const focusKey = focus ? [focus.minX, focus.minY, focus.maxX, focus.maxY].join() : null;
  const [fitted, setFitted] = useState<{
    key: unknown;
    focusKey: string | null;
    width: number;
    height: number;
  } | null>(null);
  /** Khung nhìn đích khi đang trượt tới vùng `focus`. */
  const [glideTo, setGlideTo] = useState<ViewTransform | null>(null);
  if (bounds && size.width > 0 && size.height > 0) {
    if (fitted?.key !== key || fitted.width !== size.width || fitted.height !== size.height) {
      setFitted({ key, focusKey, width: size.width, height: size.height });
      setGlideTo(null);
      setView(
        focus
          ? centeredTransform(focus, focusPadding)
          : { ...fitTransform(bounds, size.width, size.height, padding, rotation), rotation },
      );
    } else if (fitted.focusKey !== focusKey) {
      setFitted({ ...fitted, focusKey });
      if (focus) setGlideTo(centeredTransform(focus, focusPadding));
    } else if ((view.rotation ?? 0) !== rotation) {
      setView(rotateAt(view, screenCenter, rotation));
    }
  }
  const rotationRef = useRef(rotation);
  useEffect(() => {
    rotationRef.current = rotation;
  });

  /** Đồng bộ vị trí stage (Konva tự đổi khi kéo) về state. */
  const currentView = useCallback((): ViewTransform => {
    const stage = stageRef.current;
    return stage
      ? { x: stage.x(), y: stage.y(), scale: stage.scaleX(), rotation: stage.rotation() }
      : view;
  }, [view]);

  // Trượt mượt tới `glideTo`. Người dùng kéo/zoom thì dừng ngay.
  const glideFrame = useRef(0);
  const stopGlide = () => cancelAnimationFrame(glideFrame.current);
  useEffect(() => {
    if (!glideTo) return;
    const stage = stageRef.current;
    const from = stage
      ? { x: stage.x(), y: stage.y(), scale: stage.scaleX(), rotation: stage.rotation() }
      : null;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!from || reduced) {
      setView(glideTo);
      return;
    }
    const started = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - started) / GLIDE_MS);
      const e = 1 - (1 - p) ** 3;
      // Nội suy tỉ lệ theo log để zoom đều mắt; toạ độ tâm khung nội suy tuyến tính.
      const scale = from.scale * (glideTo.scale / from.scale) ** e;
      const center = { x: size.width / 2, y: size.height / 2 };
      const a = screenToWorld(from, center);
      const b = screenToWorld(glideTo, center);
      const w = { x: lerpNum(a.x, b.x, e), y: lerpNum(a.y, b.y, e) };
      // Góc xoay lấy giá trị mới nhất: la bàn có thể đổi trong lúc đang trượt.
      setView(centeredView(w, scale, rotationRef.current, size.width, size.height));
      if (p < 1) glideFrame.current = requestAnimationFrame(tick);
    };
    glideFrame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(glideFrame.current);
  }, [glideTo]);

  useImperativeHandle(
    ref,
    () => ({
      fit: () => {
        if (bounds && size.width && size.height) {
          setView({
            ...fitTransform(bounds, size.width, size.height, padding, rotation),
            rotation,
          });
        }
      },
      fitBounds: (b, pad = 60) => {
        if (!size.width || !size.height) return;
        const s = clampScale(fitTransform(b, size.width, size.height, pad, rotation).scale);
        const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
        setView(centeredView(c, s, rotation, size.width, size.height));
      },
      zoomBy: (factor) => {
        const v = currentView();
        setView(zoomAt(v, { x: size.width / 2, y: size.height / 2 }, clampScale(v.scale * factor)));
      },
      centerOn: (p, scale) => {
        const s = clampScale(scale ?? currentView().scale);
        setView(centeredView(p, s, rotation, size.width, size.height));
      },
      panBy: (dx, dy) => {
        stopGlide();
        const v = currentView();
        const next = { ...v, x: v.x + dx, y: v.y + dy };
        // Dời stage ngay để các lần bấm liên tiếp (giữ phím) cộng dồn trước khi React vẽ lại.
        stageRef.current?.position({ x: next.x, y: next.y });
        setView(next);
      },
      getTransform: currentView,
    }),
    [bounds, size.width, size.height, padding, rotation, clampScale, currentView],
  );

  const handleWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    stopGlide();
    const pointer = e.target.getStage()?.getPointerPosition();
    if (!pointer) return;
    const v = currentView();
    setView(zoomAt(v, pointer, clampScale(v.scale * Math.exp(-e.evt.deltaY * WHEEL_SENSITIVITY))));
  };

  // Pinch zoom bằng 2 ngón tay.
  const pinch = useRef<{ dist: number; center: Point } | null>(null);
  const handleTouchMove = (e: KonvaEventObject<TouchEvent>) => {
    const touches = e.evt.touches;
    const stage = stageRef.current;
    if (touches.length !== 2 || !stage) return;
    e.evt.preventDefault();
    stopGlide();
    if (stage.isDragging()) stage.stopDrag();
    const rect = stage.container().getBoundingClientRect();
    const p1 = { x: touches[0]!.clientX - rect.left, y: touches[0]!.clientY - rect.top };
    const p2 = { x: touches[1]!.clientX - rect.left, y: touches[1]!.clientY - rect.top };
    const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const dist = distance(p1, p2);
    const prev = pinch.current;
    pinch.current = { dist, center };
    if (!prev || prev.dist === 0) return;
    const v = currentView();
    const zoomed = zoomAt(v, prev.center, clampScale(v.scale * (dist / prev.dist)));
    setView({
      ...zoomed,
      x: zoomed.x + center.x - prev.center.x,
      y: zoomed.y + center.y - prev.center.y,
    });
  };
  const endPinch = () => {
    pinch.current = null;
  };

  const handleDragStart = (e: KonvaEventObject<DragEvent>) => {
    const stage = stageRef.current;
    if (e.target !== stage) return;
    stopGlide();
    const evt: Event | undefined = e.evt;
    // Cảm ứng luôn được kéo (1 ngón = pan). Chuột: chỉ các nút trong panButtons.
    if (
      !(evt instanceof MouseEvent) ||
      (evt instanceof PointerEvent && evt.pointerType === 'touch')
    ) {
      return;
    }
    const allowed = panButtons.reduce((mask, b) => mask | (BUTTON_MASK[b] ?? 0), 0);
    if ((evt.buttons & allowed) === 0) {
      stage.stopDrag();
      stage.position({ x: view.x, y: view.y });
    }
  };

  // Cập nhật state cả khi đang kéo để các lớp phụ thuộc vùng nhìn (lưới) đi theo.
  const handleDragMove = (e: KonvaEventObject<DragEvent>) => {
    if (e.target === stageRef.current) setView(currentView());
  };

  const handleClick = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!onWorldClick || e.evt.defaultPrevented) return;
    const p = e.target.getStage()?.getRelativePointerPosition();
    if (p) onWorldClick(p);
  };

  const handlePointerMove = (e: KonvaEventObject<PointerEvent>) => {
    if (!onWorldPointerMove) return;
    onWorldPointerMove(stageRef.current?.getRelativePointerPosition() ?? null, e.evt);
  };

  const withWorld =
    <E,>(handler: ((p: Point, evt: E) => void) | undefined) =>
    (e: KonvaEventObject<E>) => {
      const p = stageRef.current?.getRelativePointerPosition();
      if (handler && p) handler(p, e.evt);
    };

  const viewport = useMemo<ViewportValue>(
    () => ({
      scale: view.scale,
      rotation: view.rotation ?? 0,
      rect: boundsOf(
        [
          { x: 0, y: 0 },
          { x: size.width, y: 0 },
          { x: size.width, y: size.height },
          { x: 0, y: size.height },
        ].map((p) => screenToWorld(view, p)),
      )!,
    }),
    [view, size.width, size.height],
  );

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        touchAction: 'none',
        background,
        cursor,
        ...style,
      }}
    >
      {size.width > 0 && size.height > 0 && (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          x={view.x}
          y={view.y}
          scaleX={view.scale}
          scaleY={view.scale}
          rotation={view.rotation ?? 0}
          draggable
          onWheel={handleWheel}
          onTouchMove={handleTouchMove}
          onTouchEnd={endPinch}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragMove}
          onClick={handleClick}
          onTap={handleClick}
          onDblClick={withWorld<MouseEvent>(onWorldDblClick && ((p) => onWorldDblClick(p)))}
          onPointerDown={withWorld(onWorldPointerDown)}
          onPointerUp={withWorld(onWorldPointerUp)}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => onWorldPointerMove?.(null)}
        >
          <ViewportContext.Provider value={viewport}>{children}</ViewportContext.Provider>
        </Stage>
      )}
    </div>
  );
}
