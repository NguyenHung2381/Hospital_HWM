import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { CampusPage } from './pages/CampusPage';
import { CampusRoutePage } from './pages/CampusRoutePage';
import { HomePage } from './pages/HomePage';
import { LocatePage } from './pages/LocatePage';
import { NavigatePage } from './pages/NavigatePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PickLocationPage } from './pages/PickLocationPage';
import { RootLayout } from './RootLayout';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/locate', element: <LocatePage /> },
      { path: '/locate/pick', element: <PickLocationPage /> },
      { path: '/navigate/:targetId', element: <NavigatePage /> },
      { path: '/campus', element: <CampusPage /> },
      { path: '/campus-route', element: <CampusRoutePage /> },
      { path: '*', element: <NotFoundPage /> },
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
