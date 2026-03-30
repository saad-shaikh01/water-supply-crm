import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { QueryProvider } from '@water-supply-crm/data-access';
import { Toaster } from '@water-supply-crm/ui';
import { ThemeProvider } from '../components/layout/theme-provider';
import './global.css';

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
