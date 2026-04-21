/**
 * Root layout for the HomeHub web app.
 *
 * This is the M0 shell: fonts, tokens, dark default. The real layout
 * tree (auth boundary, `getHouseholdContext()`, global ⌘K launcher)
 * lands in M1 under @frontend-chat per
 * `specs/07-frontend/ui-architecture.md`.
 */

import { Inter, JetBrains_Mono } from 'next/font/google';

import type { Metadata, Viewport } from 'next';

import { cn } from '@/lib/cn';

import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'HomeHub',
    template: '%s · HomeHub',
  },
  description: 'Household AI control panel.',
  icons: {
    icon: '/favicon.ico',
  },
};

export const viewport: Viewport = {
  colorScheme: 'dark light',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#1a1a24' },
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={cn(inter.variable, jetbrainsMono.variable)}
      suppressHydrationWarning
    >
      <body className="min-h-svh bg-bg text-fg antialiased">{children}</body>
    </html>
  );
}
