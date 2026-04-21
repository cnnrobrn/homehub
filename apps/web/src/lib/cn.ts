/**
 * `cn` — class-name composer.
 *
 * Combines `clsx` (conditional / array / object class composition) with
 * `tailwind-merge` (last-wins conflict resolution for Tailwind utilities)
 * so components can accept arbitrary `className` props without fighting
 * internal defaults. Shadcn/ui and most Tailwind component libraries
 * expect this helper to exist at `@/lib/cn` (or `@/lib/utils`); we use
 * the shorter name.
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
