import type { ComponentProps } from 'react';

import { cn } from '@/lib/cn';

interface HomeHubMarkProps extends ComponentProps<'svg'> {
  size?: number;
}

export function HomeHubMark({ size = 18, className, ...props }: HomeHubMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
      className={cn('shrink-0', className)}
      {...props}
    >
      <rect
        x="1.2"
        y="5.4"
        width="15.6"
        height="11.4"
        rx="1.4"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M1.2 8.1 9 1.5l7.8 6.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="9" cy="12.1" r="1.45" fill="currentColor" />
    </svg>
  );
}
