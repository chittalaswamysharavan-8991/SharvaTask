import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'TaskState MCP Control Center',
  description: 'Persistent work-state control center for AI assistants, with durable lists, tasks, proof, and history.',
  applicationName: 'TaskState MCP',
  robots: { index: false, follow: false }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
