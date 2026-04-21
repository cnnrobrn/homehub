/**
 * Design-system primitives for the HomeHub app re-skin.
 *
 * These components mirror the Claude Design prototype's visual
 * vocabulary so every page in the authenticated app stays cohesive:
 *
 *  - Eyebrow / SectionHead — small mono uppercase labels.
 *  - SegDot                — a colored dot for segment signal (paired
 *                            with text so color is never sole channel).
 *  - Kbd                   — keyboard-shortcut label.
 *  - PageHeader            — date + headline + sub shared across the
 *                            Today, segment, and detail views.
 *  - LookCard              — "worth a look" suggestion with segment
 *                            stripe + primary/secondary actions.
 *  - DecisionCard          — approvals inbox card with header meta,
 *                            preview callout, context line, 3 actions.
 *  - FactList              — 2-col grid of mono key / body value.
 *  - NoteCallout           — accent-striped info/reminder callout.
 *  - PillPrompt            — chat composer quick prompt chip.
 *
 * Every primitive accepts `className` via `cn()` so pages can
 * override spacing / widths without forking the component.
 */

import { SEGMENTS } from './segment';

import type { SegmentId } from './segment';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { cn } from '@/lib/cn';

/* ── Text bits ────────────────────────────────────────────────── */

export function Eyebrow({ children, className, ...rest }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      {...rest}
      className={cn('font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-muted', className)}
    >
      {children}
    </div>
  );
}

export function SectionHead({
  children,
  sub,
  className,
}: {
  children: ReactNode;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex items-baseline gap-2', className)}>
      <h2 className="m-0 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-fg">
        {children}
      </h2>
      {sub ? (
        <span className="font-mono text-[10.5px] text-fg-muted tracking-[0.04em]">· {sub}</span>
      ) : null}
    </div>
  );
}

export function Kbd({
  children,
  muted = false,
  className,
}: {
  children: ReactNode;
  muted?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[3px] border px-1.5 py-px font-mono text-[10.5px] tracking-[0.04em]',
        muted
          ? 'border-border bg-transparent text-fg-muted'
          : 'border-border bg-surface text-fg shadow-[0_1px_0_var(--color-border)]',
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ── Segment signal ───────────────────────────────────────────── */

export function SegDot({
  segment,
  size = 8,
  className,
}: {
  segment: SegmentId;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block rounded-full', className)}
      style={{
        width: size,
        height: size,
        background: SEGMENTS[segment].color,
      }}
    />
  );
}

/* ── Page header ──────────────────────────────────────────────── */

export function PageHeader({
  eyebrow,
  title,
  sub,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-9 flex flex-col gap-3', className)}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h1 className="m-0 max-w-[640px] text-[34px] font-semibold leading-[1.15] tracking-[-0.03em] text-balance">
        {title}
      </h1>
      {sub ? (
        <p className="m-0 max-w-[560px] text-[17px] leading-[1.55] text-fg-muted text-pretty">
          {sub}
        </p>
      ) : null}
    </header>
  );
}

/* ── Cards ────────────────────────────────────────────────────── */

export function LookCard({
  segment,
  title,
  body,
  primaryAction,
  secondaryAction,
  className,
}: {
  segment: SegmentId;
  title: ReactNode;
  body: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-[4px_1fr] gap-[18px] rounded-md border border-border bg-surface px-[22px] py-5 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.08)]',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="rounded-[2px] opacity-80"
        style={{ background: SEGMENTS[segment].color }}
      />
      <div>
        <div className="mb-1.5 text-[16px] font-semibold leading-[1.3] tracking-[-0.015em]">
          {title}
        </div>
        <div className="mb-3.5 max-w-[560px] text-[14px] leading-[1.55] text-fg-muted">{body}</div>
        {(primaryAction || secondaryAction) && (
          <div className="flex items-center gap-2">
            {primaryAction}
            {secondaryAction}
          </div>
        )}
      </div>
    </div>
  );
}

export function DecisionCard({
  segment,
  meta,
  expires,
  title,
  preview,
  why,
  actions,
  className,
}: {
  segment: SegmentId;
  /** Short meta shown top-left next to the segment dot (e.g. "for Priya"). */
  meta: ReactNode;
  /** Right-aligned expiry hint (e.g. "waits until Thu"). */
  expires?: ReactNode;
  title: ReactNode;
  /** The drafted content that would go out if approved. */
  preview: ReactNode;
  /** Short rationale line prefixed with "why · ". */
  why?: ReactNode;
  actions: ReactNode;
  className?: string;
}) {
  const color = SEGMENTS[segment].color;
  return (
    <article
      className={cn(
        'overflow-hidden rounded-md border border-border bg-surface shadow-[0_8px_24px_-8px_rgba(0,0,0,0.08)]',
        className,
      )}
    >
      <div className="flex items-center gap-2.5 border-b border-border px-[18px] py-2.5 font-mono text-[10.5px] uppercase tracking-[0.04em] text-fg-muted">
        <SegDot segment={segment} />
        <span>{meta}</span>
        <div className="flex-1" />
        {expires ? <span>{expires}</span> : null}
      </div>
      <div className="px-[22px] pt-[18px] pb-5">
        <div className="mb-2.5 text-[16px] font-semibold leading-[1.35] tracking-[-0.02em]">
          {title}
        </div>
        <div
          className="mb-2.5 rounded-[3px] border-l-2 bg-surface-soft px-3.5 py-3 text-[13.5px] leading-[1.55] text-fg"
          style={{ borderLeftColor: color }}
        >
          {preview}
        </div>
        {why ? <div className="mb-3.5 text-[12px] italic text-fg-muted">why · {why}</div> : null}
        <div className="flex flex-wrap gap-2">{actions}</div>
      </div>
    </article>
  );
}

/* ── Lists ────────────────────────────────────────────────────── */

export function FactList({
  items,
  keyWidth = 140,
  className,
}: {
  items: readonly { k: ReactNode; v: ReactNode }[];
  keyWidth?: number;
  className?: string;
}) {
  return (
    <dl className={cn('overflow-hidden rounded-md border border-border bg-surface', className)}>
      {items.map((it, i) => (
        <div
          key={i}
          className={cn('grid gap-4 px-[18px] py-[11px]', i === 0 ? '' : 'border-t border-border')}
          style={{ gridTemplateColumns: `${keyWidth}px 1fr` }}
        >
          <dt className="font-mono text-[11.5px] uppercase tracking-[0.03em] text-fg-muted">
            {it.k}
          </dt>
          <dd className="m-0 text-[13.5px] leading-[1.55]">{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ── Callouts ─────────────────────────────────────────────────── */

export function NoteCallout({
  children,
  className,
  tone = 'accent',
}: {
  children: ReactNode;
  className?: string;
  /** `accent` uses the teal accent stripe; `segment` lets callers pass their own via inline style. */
  tone?: 'accent';
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3.5 rounded-[4px] border border-border bg-surface-note p-[14px] px-[18px]',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn('w-[3px] self-stretch rounded-[2px]', tone === 'accent' ? 'bg-accent' : '')}
      />
      <div className="flex-1 text-[13.5px] leading-[1.55]">{children}</div>
    </div>
  );
}

/* ── Chat composer bits ───────────────────────────────────────── */

export function PillPrompt({ children, className, ...rest }: ComponentPropsWithoutRef<'button'>) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'cursor-pointer rounded-full border border-border bg-surface px-3 py-1.5 text-[12px] text-fg-muted transition-colors hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ── Logo (reused across sidebar + bot avatar) ────────────────── */

export function HomeHubMark({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      <rect x="1" y="5" width="16" height="12" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1 8L9 1l8 7" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="9" cy="12" r="1.5" fill="var(--color-accent)" />
    </svg>
  );
}

/* ── Household member avatar ──────────────────────────────────── */

export interface MemberAvatarProps {
  /** Member display name; used for tooltip + initial fallback. */
  name: string;
  /** Optional pre-computed hue (0–360) — skips auto-hash. */
  hue?: number;
  size?: number;
  className?: string;
}

function hashHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

export function MemberAvatar({ name, hue, size = 22, className }: MemberAvatarProps) {
  const resolvedHue = hue ?? hashHue(name);
  const initial = (name || '?').trim().slice(0, 1).toUpperCase();
  return (
    <div
      title={name}
      className={cn(
        'inline-flex items-center justify-center rounded-full border border-border font-semibold text-fg',
        className,
      )}
      style={{
        width: size,
        height: size,
        background: `oklch(0.86 0.05 ${resolvedHue})`,
        fontSize: size * 0.42,
      }}
    >
      {initial}
    </div>
  );
}

/* ── Warm button styles ──────────────────────────────────────── */

/**
 * The design uses three button flavors that the existing `Button`
 * primitive doesn't fully cover (ink-fill primary, ghost outline,
 * truly quiet). These wrappers keep pages terse.
 */
export function WarmButton({
  variant = 'primary',
  size = 'md',
  className,
  ...rest
}: ComponentPropsWithoutRef<'button'> & {
  variant?: 'primary' | 'ghost' | 'quiet';
  size?: 'sm' | 'md';
}) {
  const sizing = size === 'sm' ? 'px-2.5 py-1 text-[12px]' : 'px-3.5 py-2 text-[13px]';
  const tone =
    variant === 'primary'
      ? 'bg-fg text-bg hover:bg-fg/90'
      : variant === 'ghost'
        ? 'border border-border bg-transparent text-fg hover:bg-surface-soft'
        : 'bg-transparent text-fg-muted hover:text-fg';
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[3px] border border-transparent font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        sizing,
        tone,
        className,
      )}
    >
      {rest.children}
    </button>
  );
}
