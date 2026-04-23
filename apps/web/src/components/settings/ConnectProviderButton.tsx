/**
 * `ConnectProviderButton` — start a Nango OAuth flow in a popup window.
 *
 * Nango's Connect API has no `redirect_url` parameter, so a top-level
 * navigation to its OAuth URL strands the user on Nango's success page.
 * We sidestep that by opening the URL in a popup: the caller stays on
 * the originating page (e.g. `/settings/connections`), and when the
 * popup closes we `router.refresh()` so the row the webhook wrote shows
 * up. We also re-refresh a couple of times over the next few seconds to
 * cover the common case where the webhook lands a beat after the user
 * closes the window.
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
const REFRESH_TIMES_MS = [0, 2_000, 5_000, 10_000] as const;
const WATCH_TIMEOUT_MS = 10_500;

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

  useEffect(() => {
    return () => {
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    };
  }, []);

  async function onClick() {
    setError(null);
    setPending(true);
    try {
      const res = await startConnectSessionAction({ provider, categories: categories?.slice() });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      onStarted?.();

      const popup = window.open(res.data.connectUrl, 'homehub-nango-connect', POPUP_FEATURES);
      if (!popup) {
        // Popup blocked — fall back to full-page nav. The user will have
        // to navigate back manually after OAuth; the connection itself
        // still persists via the Nango webhook.
        window.location.href = res.data.connectUrl;
        return;
      }

      setWatching(true);
      const interval = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(interval);
          // Re-fetch the current page's data a few times; the webhook
          // that writes `sync.provider_connection` usually lands within
          // 1–3s of OAuth completion but can take longer.
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
      }, 500);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant={variant} disabled={pending || watching} onClick={onClick} type="button">
        {watching ? 'Finishing connection…' : pending ? 'Opening…' : children}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
