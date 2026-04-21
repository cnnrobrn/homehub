/**
 * Minimal form helpers wrapping `react-hook-form`.
 *
 * Rather than shipping the full shadcn/ui form primitive (which pulls in
 * a large component graph), we expose only what our forms need:
 *   - `<FormField />` — wires a RHF Controller to a render function.
 *   - `<FormMessage />` — renders the first validation error for a field
 *     with `role="alert"` + `aria-live="polite"` so screen readers
 *     announce it on change.
 *
 * The intent is to keep the form surface obvious and accessible without
 * extra abstraction layers.
 */

'use client';

import * as React from 'react';

import { cn } from '@/lib/cn';

export const FormMessage = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement> & { error?: string | null }
>(({ className, error, children, ...props }, ref) => {
  const body = error ?? children;
  if (!body) return null;
  return (
    <p
      ref={ref}
      role="alert"
      aria-live="polite"
      className={cn('mt-1 text-sm text-danger', className)}
      {...props}
    >
      {body}
    </p>
  );
});
FormMessage.displayName = 'FormMessage';
