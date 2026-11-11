import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { QueryProvider } from '@water-supply-crm/data-access';
import { Toaster } from '@water-supply-crm/ui';
import { ThemeProvider } from '../components/layout/theme-provider';
import { SessionListener } from '../components/layout/session-listener';
import './global.css';

// The CSP nonce (src/middleware.ts) is per request, so pages must render dynamically for Next to stamp it on its scripts.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'WaterCRM — Admin Panel',
  description: 'Platform administration for Water Supply CRM',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            <SessionListener />
            <NuqsAdapter>
              {children}
            </NuqsAdapter>
            <Toaster />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
