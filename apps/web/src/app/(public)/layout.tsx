/**
 * Layout for public (unauthenticated) routes.
 *
 * This layout intentionally does NOT resolve household context or enforce
 * auth — it exists so `/login`, `/invite/[token]`, and `/auth/callback`
 * render without tripping the `(app)` auth boundary.
 */

import type { ReactNode } from 'react';

import { Toaster } from '@/components/ui/toaster';

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-bg text-fg">
      <main className="min-h-svh">{children}</main>
      <Toaster />
    </div>
  );
}
