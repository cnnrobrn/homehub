/**
 * `ConnectProviderButton` — start a Nango OAuth flow in a popup window.
 *
 * Nango's Connect API has no `redirect_url` parameter, so a top-level
 * navigation to its OAuth URL strands the user on Nango's success page.
 * We sidestep that by opening the URL in a popup: the caller stays on
 * the originating page (e.g. `/settings/connections`). We refresh the
 * page after opening the popup so the row the webhook wrote shows up.
 * Multiple refreshes cover the common case where the webhook lands a
 * beat after OAuth completes.
 *
 * Browser COOP isolation can sever access to the popup once it reaches
 * Google/Nango, so we never read `popup.closed`. Instead we refresh on
 * a short timer sequence and when focus returns to this tab.
 *
 * If the popup is blocked (return value is `null`), we fall back to a
 * full-page navigation so the flow still completes; the user returns
 * manually but at least doesn't lose the connection itself.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { startConnectSessionAction } from '@/app/actions/integrations';
import { Button } from '@/components/ui/button';

type Provider = 'google-calendar' | 'google-mail' | 'ynab';

interface Props {
  provider: Provider;
  children: React.ReactNode;
  categories?: readonly string[];
  variant?: React.ComponentProps<typeof Button>['variant'];
  onStarted?: () => void;
}

const POPUP_FEATURES = 'width=640,height=720,menubar=no,toolbar=no,location=yes';
const REFRESH_TIMES_MS = [1_000, 3_000, 7_000, 15_000, 30_000] as const;
const RETURN_REFRESH_TIMES_MS = [0, 1_500, 4_000] as const;
const WATCH_TIMEOUT_MS = 31_000;
const RETURN_SETTLE_MS = 4_500;

export function ConnectProviderButton({
  provider,
  children,
  categories,
  variant,
  onStarted,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [watching, setWatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const returnRefreshScheduled = useRef(false);

  useEffect(() => {
    return () => {
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    };
  }, []);

  useEffect(() => {
    if (!watching) return;

    function scheduleReturnRefreshes() {
      if (returnRefreshScheduled.current) return;
      returnRefreshScheduled.current = true;
      for (const delay of RETURN_REFRESH_TIMES_MS) {
        timers.current.push(
          setTimeout(() => {
            router.refresh();
          }, delay),
        );
      }
      timers.current.push(
        setTimeout(() => {
          setWatching(false);
        }, RETURN_SETTLE_MS),
      );
    }

    function onVisibilityChange() {
      if (!document.hidden) scheduleReturnRefreshes();
    }

    window.addEventListener('focus', scheduleReturnRefreshes);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', scheduleReturnRefreshes);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [router, watching]);

  function clearTimers() {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }

  function scheduleBackgroundRefreshes() {
    clearTimers();
    for (const delay of REFRESH_TIMES_MS) {
      timers.current.push(
        setTimeout(() => {
          router.refresh();
        }, delay),
      );
    }
    timers.current.push(
      setTimeout(() => {
        setWatching(false);
      }, WATCH_TIMEOUT_MS),
    );
  }

  async function onClick() {
    setError(null);
    clearTimers();
    returnRefreshScheduled.current = false;
    setPending(true);
    try {
      const res = await startConnectSessionAction({ provider, categories: categories?.slice() });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      onStarted?.();

      // `_blank` forces a fresh popup every time. A stable window name
      // (the old `homehub-nango-connect`) would route subsequent clicks
      // into a still-open stale popup — e.g. a previous Nango session
      // would be reused even after we switched google to native OAuth.
      if (!window.open(res.data.connectUrl, '_blank', POPUP_FEATURES)) {
        // Popup blocked — fall back to full-page nav. The user will
        // have to navigate back manually after OAuth; the connection
        // itself still persists via the callback / Nango webhook.
        window.location.href = res.data.connectUrl;
        return;
      }

      setWatching(true);
      scheduleBackgroundRefreshes();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant={variant} disabled={pending || watching} onClick={onClick} type="button">
        {watching ? 'Checking connection…' : pending ? 'Opening…' : children}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
