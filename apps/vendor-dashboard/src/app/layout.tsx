import type { Metadata } from 'next';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { QueryProvider } from '@water-supply-crm/data-access';
import { Toaster } from '@water-supply-crm/ui';
import { ThemeProvider } from '../components/layout/theme-provider';
import { StoreHydration } from '../components/providers/store-hydration';
import './global.css';

export const metadata: Metadata = {
  title: 'Vendor Dashboard - Water Supply CRM',
  description: 'Manage your water supply business efficiently',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            <NuqsAdapter>
              <StoreHydration />
              {children}
            </NuqsAdapter>
            <Toaster />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
