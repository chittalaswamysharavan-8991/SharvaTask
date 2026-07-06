import type { ReactNode } from 'react';

export const metadata = {
  title: 'SharvaTask MCP V2',
  description: 'Persistent list history MCP for SharvaOS.'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
