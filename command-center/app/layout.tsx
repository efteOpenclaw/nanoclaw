import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'NanoClaw Command Center',
  description: 'System dashboard for NanoClaw AI assistant host',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace',
          backgroundColor: '#0a0a0a',
          color: '#e0e0e0',
          minHeight: '100vh',
        }}
      >
        {children}
      </body>
    </html>
  );
}
