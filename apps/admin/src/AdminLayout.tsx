import { useEffect } from 'react';
import { NavLink, Outlet, useBlocker, useLocation } from 'react-router';
import { BuildingSwitcher } from './BuildingSwitcher';
import { DRAFT_PATHS, discardAll, useDraftSync } from './editor/draft';
import { SaveBar, SaveErrorAlert } from './editor/SaveBar';
import { useEditor } from './editor/store';
import { isCampusDirty, useCampusDraft } from './site/campusDraft';
import './editor/editor.css';

const NAV = [
  { to: '/', label: 'Tổng quan', end: true },
  { to: '/map', label: 'Vẽ toà nhà' },
  { to: '/site', label: 'Khuôn viên' },
  { to: '/departments', label: 'Khoa phòng' },
  { to: '/traffic', label: 'Lưu lượng' },
];

const isDraftPath = (pathname: string) => DRAFT_PATHS.some((p) => pathname.startsWith(p));
const isMapPath = (pathname: string) => pathname.startsWith('/map') || pathname.startsWith('/site');

export function AdminLayout() {
  const building = useDraftSync();
  const buildingDirty = useEditor((s) => s.dirty);
  const campusDirty = useCampusDraft(isCampusDirty);
  const dirty = buildingDirty || campusDirty;
  const { pathname } = useLocation();
  const onDraftPage = isDraftPath(pathname);

  // Cảnh báo khi rời các trang sửa dữ liệu mà còn thay đổi chưa lưu.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && isDraftPath(currentLocation.pathname) && !isDraftPath(nextLocation.pathname),
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm('Có thay đổi chưa lưu. Rời trang và bỏ các thay đổi?')) {
      discardAll();
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">HWN Admin</div>
        <nav>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="content">
        <header className="topbar">
          {/* Hai trang vẽ sửa mọi toà ngay trên khung vẽ (click vào toà nào là sửa toà đó). */}
          {!isMapPath(pathname) && <BuildingSwitcher building={building.data} />}
          {onDraftPage && <SaveBar />}
        </header>
        <main className="main">
          {onDraftPage && <SaveErrorAlert />}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
