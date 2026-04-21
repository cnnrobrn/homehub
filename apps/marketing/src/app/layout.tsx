import { type Metadata, type Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';

import { cn } from '@/lib/cn';

import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'HomeHub — The quiet notebook for everything in your week.',
    template: '%s · HomeHub',
  },
  description:
    'Open-source, self-hostable notebook for the small stuff of a life — dinners, groceries, runs, birthdays, plans with friends. No streaks, no nudges, no selling you anything.',
  icons: {
    icon: '/favicon.ico',
  },
  openGraph: {
    title: 'HomeHub — The quiet notebook for everything in your week.',
    description:
      'Open-source, self-hostable notebook for the small stuff of a life. Free forever when self-hosted.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#fafaf7',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={cn(inter.variable, jetbrainsMono.variable)}>
      <body className="bg-bg text-ink min-h-svh antialiased">{children}</body>
    </html>
  );
}
