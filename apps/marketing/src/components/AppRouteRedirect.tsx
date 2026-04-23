'use client';

import { useEffect, useState } from 'react';

import { APP_ORIGIN } from '@/lib/app-url';

function normalizeAppPath(pathname: string): string {
  const withoutTrailingSlash =
    pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

  if (withoutTrailingSlash === '/signup') {
    return '/login';
  }

  return withoutTrailingSlash || '/login';
}

export function AppRouteRedirect({ fallbackPath }: { fallbackPath: string }) {
  const [href, setHref] = useState(`${APP_ORIGIN}${fallbackPath}`);

  useEffect(() => {
    const destination = `${APP_ORIGIN}${normalizeAppPath(window.location.pathname)}${window.location.search}${window.location.hash}`;
    setHref(destination);
    window.location.replace(destination);
  }, []);

  return (
    <main className="bg-bg text-ink flex min-h-svh items-center justify-center px-6">
      <a
        href={href}
        className="border-rule hover:border-ink rounded-[3px] border px-4 py-3 text-sm transition-colors"
      >
        Continue to HomeHub
      </a>
    </main>
  );
}
