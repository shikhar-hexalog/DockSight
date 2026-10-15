import { Outlet } from 'react-router';

import { ReturnDetailSheet } from '@/components/returns/ReturnDetailSheet';
import { DeskProvider } from '@/desk/DeskProvider';

import { Sidebar } from './Sidebar';

export function AppShell() {
  return (
    // The desk lives at the shell level so waiting scans keep syncing on every page.
    <DeskProvider>
      <div className="flex h-dvh overflow-hidden bg-background">
        <Sidebar />

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>

        <ReturnDetailSheet />
      </div>
    </DeskProvider>
  );
}
