import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, useParams } from 'react-router';
import { AdminLayout } from './AdminLayout';
import { CampusesPage } from './pages/CampusesPage';
import { DashboardPage } from './pages/DashboardPage';
import { DepartmentsPage } from './pages/DepartmentsPage';
import { MapEditorPage } from './pages/MapEditorPage';
import { TrafficPage } from './pages/TrafficPage';
import { useActiveBuildingId, useCampus } from './lib/queries';

/** Đường dẫn cũ của trang "Mặt bằng tổng thể": mở trang Khuôn viên ở toà đầu tiên của cơ sở. */
function SitePlanRedirect() {
  const { campusId } = useParams();
  const campus = useCampus(campusId);
  const first = campus.data?.buildings[0]?.buildingId;
  useEffect(() => {
    if (!first) return;
    useActiveBuildingId.getState().setBuildingId(first);
  }, [first]);
  if (campus.isPending) return <p className="muted">Đang tải…</p>;
  return <Navigate to={first ? '/site' : '/campuses'} replace />;
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  {
    path: '/',
    element: <AdminLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'map', element: <MapEditorPage key="building" mode="building" /> },
      { path: 'site', element: <MapEditorPage key="site" mode="site" /> },
      { path: 'departments', element: <DepartmentsPage /> },
      { path: 'campuses', element: <CampusesPage /> },
      { path: 'campuses/:campusId/site', element: <SitePlanRedirect /> },
      { path: 'traffic', element: <TrafficPage /> },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
