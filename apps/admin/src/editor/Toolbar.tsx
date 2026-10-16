import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useEditor } from './store';
import { TOOL_GROUPS, type ToolDef } from './tools';
import { TOOL_VARIANTS, type ToolVariantMenu } from './toolVariants';
import type { Tool } from './types';

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const buttons = useRef<Partial<Record<Tool, HTMLButtonElement | null>>>({});
  const [openMenu, setOpenMenu] = useState<Tool | null>(null);
  const closeMenu = useCallback(() => setOpenMenu(null), []);
  const getAnchor = useCallback(
    () => (openMenu ? (buttons.current[openMenu] ?? null) : null),
    [openMenu],
  );

  // Rời công cụ đang mở menu (vd. bằng phím tắt) thì đóng menu.
  if (openMenu && tool !== openMenu) setOpenMenu(null);

  const menu = openMenu ? TOOL_VARIANTS[openMenu] : undefined;

  return (
    <div
      className="editor-toolbar"
      role="toolbar"
      aria-label="Công cụ vẽ"
      aria-orientation="vertical"
    >
      {TOOL_GROUPS.map((group, i) => (
        <div key={i} className="editor-toolbar-group">
          {group.map((t) => (
            <ToolButton
              key={t.tool}
              def={t}
              active={tool === t.tool}
              menuOpen={openMenu === t.tool}
              buttonRef={(el) => {
                buttons.current[t.tool] = el;
              }}
              onOpenMenu={(open) => setOpenMenu(open ? t.tool : null)}
            />
          ))}
        </div>
      ))}
      {menu && <VariantMenu menu={menu} getAnchor={getAnchor} onClose={closeMenu} />}
    </div>
  );
}

function ToolButton({
  def,
  active,
  menuOpen,
  buttonRef,
  onOpenMenu,
}: {
  def: ToolDef;
  active: boolean;
  menuOpen: boolean;
  buttonRef: (el: HTMLButtonElement | null) => void;
  onOpenMenu: (open: boolean) => void;
}) {
  const setTool = useEditor((s) => s.setTool);
  const menu = TOOL_VARIANTS[def.tool];
  const current = useEditor((s) => menu?.current(s));
  const option = menu?.options.find((o) => o.value === current);
  const label = option ? `${def.label}: ${option.label}` : def.label;

  return (
    <button
      ref={buttonRef}
      type="button"
      className={[active ? 'active' : '', menu ? 'has-menu' : ''].filter(Boolean).join(' ')}
      aria-pressed={active}
      aria-haspopup={menu ? 'menu' : undefined}
      aria-expanded={menu ? menuOpen : undefined}
      title={`${label} (${def.key})${menu ? ' · chuột phải để chọn loại' : ''}`}
      aria-label={label}
      onClick={() => {
        // Có menu: bấm lần đầu chọn công cụ + mở menu, bấm lại khi đang dùng thì bật/tắt menu.
        if (menu) onOpenMenu(active ? !menuOpen : true);
        setTool(def.tool);
      }}
      onContextMenu={
        menu
          ? (e) => {
              e.preventDefault();
              setTool(def.tool);
              onOpenMenu(true);
            }
          : undefined
      }
    >
      {option && menu?.showsCurrentIcon ? option.icon : def.icon}
    </button>
  );
}

/** Menu chọn kiểu/loại của công cụ, bật ra cạnh nút công cụ. */
function VariantMenu({
  menu,
  getAnchor,
  onClose,
}: {
  menu: ToolVariantMenu;
  getAnchor: () => HTMLButtonElement | null;
  onClose: () => void;
}) {
  const current = useEditor((s) => menu.current(s));
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const r = getAnchor()?.getBoundingClientRect();
    if (!r) return;
    const height = ref.current?.offsetHeight ?? 0;
    setPos({
      top: Math.max(8, Math.min(r.top, window.innerHeight - height - 8)),
      left: r.right + 6,
    });
  }, [getAnchor]);

  // Đưa focus vào lựa chọn hiện tại khi menu đã hiện (lúc đo vị trí menu còn bị ẩn).
  const shown = pos !== null;
  useEffect(() => {
    if (shown) ref.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [shown]);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !getAnchor()?.contains(target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        getAnchor()?.focus();
      }
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onClose);
    };
  }, [getAnchor, onClose]);

  const moveFocus = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  return createPortal(
    <div
      ref={ref}
      className="tool-variant-menu"
      role="menu"
      aria-label={menu.title}
      style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
      onKeyDown={moveFocus}
    >
      <div className="tool-variant-menu-title">{menu.title}</div>
      {menu.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="menuitemradio"
          aria-checked={o.value === current}
          className={o.value === current ? 'active' : ''}
          onClick={() => {
            menu.pick(useEditor.getState(), o.value);
            onClose();
          }}
        >
          <span className="tool-variant-menu-icon">{o.icon}</span>
          <span className="tool-variant-menu-label">{o.label}</span>
          {o.detail && <span className="tool-variant-menu-detail">{o.detail}</span>}
        </button>
      ))}
    </div>,
    document.body,
  );
}
