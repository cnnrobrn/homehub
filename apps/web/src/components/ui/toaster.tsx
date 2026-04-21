/**
 * Root-level toast renderer. Mount once at the top of the tree (inside
 * the authed layout or root layout).
 */

'use client';

import * as React from 'react';

import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from './toast';
import { dismissToast, useToasts } from './use-toast';

export function Toaster() {
  const items = useToasts();
  return (
    <ToastProvider>
      {items.map((t) => (
        <Toast
          key={t.id}
          variant={t.variant}
          {...(t.duration !== undefined ? { duration: t.duration } : {})}
          onOpenChange={(open) => {
            if (!open) dismissToast(t.id);
          }}
        >
          <div className="grid gap-1">
            {t.title ? <ToastTitle>{t.title}</ToastTitle> : null}
            {t.description ? <ToastDescription>{t.description}</ToastDescription> : null}
          </div>
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
