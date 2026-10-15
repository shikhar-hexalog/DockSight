import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router';

import { RouteError } from '@/components/common/RouteError';
import { AppShell } from '@/components/layout/AppShell';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AiPage } from '@/pages/AiPage';
import { BoardPage } from '@/pages/BoardPage';
import { DispatchPage } from '@/pages/DispatchPage';
import { ExceptionsPage } from '@/pages/ExceptionsPage';
import { OverviewPage } from '@/pages/OverviewPage';
import { ManifestPage } from '@/pages/ManifestPage';
import { PendingPage } from '@/pages/PendingPage';
import { PhoneScannerPage } from '@/pages/PhoneScannerPage';
import { QcPage } from '@/pages/QcPage';
import { ReceivePage } from '@/pages/ReceivePage';
import { ReportsPage } from '@/pages/ReportsPage';
import { ReturnsPage } from '@/pages/ReturnsPage';
import { RoadmapPage } from '@/pages/RoadmapPage';
import { SyncPage } from '@/pages/SyncPage';
import { routes } from '@/routes';

import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { path: routes.overview, element: <OverviewPage /> },
      { path: routes.board, element: <BoardPage /> },
      { path: routes.receive, element: <ReceivePage /> },
      { path: routes.manifest, element: <ManifestPage /> },
      { path: routes.qc, element: <QcPage /> },
      { path: routes.dispatch, element: <DispatchPage /> },
      { path: routes.pending, element: <PendingPage /> },
      { path: routes.exceptions, element: <ExceptionsPage /> },
      { path: routes.ai, element: <AiPage /> },
      { path: routes.reports, element: <ReportsPage /> },
      { path: routes.returns, element: <ReturnsPage /> },
      { path: routes.sync, element: <SyncPage /> },
      { path: routes.roadmap, element: <RoadmapPage /> },
    ],
  },
  // On the phone: full screen, no sidebar.
  { path: routes.phone, element: <PhoneScannerPage />, errorElement: <RouteError /> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <RouterProvider router={router} />

        <Toaster position="top-center" />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>
);
