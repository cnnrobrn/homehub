/**
 * shadcn/ui Badge primitive.
 *
 * Use for status pills: role chips, pending counts, segment tags. Variants
 * map to semantic tones — default = accent, secondary = neutral, destructive,
 * outline.
 */

import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-accent text-accent-fg',
        secondary: 'border-transparent bg-surface text-fg',
        destructive: 'border-transparent bg-danger text-fg',
        outline: 'border-border text-fg',
        warn: 'border-transparent bg-warn text-bg',
        success: 'border-transparent bg-success text-bg',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
