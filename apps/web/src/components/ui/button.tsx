/**
 * shadcn/ui Button primitive.
 *
 * Copied verbatim from shadcn/ui's new-york style (v2.x) and wired to our
 * design tokens. Variants: default / destructive / outline / secondary /
 * ghost / link. Sizes: default / sm / lg / icon. Use `asChild` to
 * compose with `next/link` or any other element while inheriting styles.
 *
 * Accessibility: focus ring is visible in every variant; disabled state
 * blocks pointer events and drops opacity to 50%.
 */

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-accent text-accent-fg hover:bg-accent/90',
        destructive: 'bg-danger text-fg hover:bg-danger/90',
        outline: 'border border-border bg-transparent hover:bg-surface hover:text-fg',
        secondary: 'bg-surface text-fg hover:bg-surface/80',
        ghost: 'hover:bg-surface hover:text-fg',
        link: 'text-accent underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-6',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
