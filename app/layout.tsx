import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'SharvaTask Control Center',
  description: 'The canonical web control center for SharvaTask lists, tasks, proof, and history.',
  applicationName: 'SharvaTask',
  robots: { index: false, follow: false }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
