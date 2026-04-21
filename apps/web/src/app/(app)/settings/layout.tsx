/**
 * Settings shell. A two-column layout: secondary nav on the left,
 * the per-page form on the right.
 */

import type { ReactNode } from 'react';

import { SettingsNav } from '@/components/settings/SettingsNav';

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6 md:flex-row">
      <aside className="w-full shrink-0 md:w-56">
        <SettingsNav />
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
