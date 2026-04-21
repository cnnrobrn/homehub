export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="1" y="5" width="16" height="12" rx="1" stroke="var(--color-ink)" strokeWidth="1.4" />
      <path d="M1 8L9 1l8 7" stroke="var(--color-ink)" strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="9" cy="12" r="1.5" fill="var(--color-accent)" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="var(--color-accent)"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 7.5L5.5 10 11 4" />
    </svg>
  );
}
