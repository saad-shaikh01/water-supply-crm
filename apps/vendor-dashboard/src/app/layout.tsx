import type { Metadata } from 'next';
import { Montserrat } from 'next/font/google';
import { QueryProvider } from '@water-supply-crm/data-access';
import { Toaster } from '@water-supply-crm/ui';
import { ThemeProvider } from '../components/layout/theme-provider';
import { StoreHydration } from '../components/providers/store-hydration';
import './global.css';

const montserrat = Montserrat({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['400', '500', '700', '800'],
  display: 'swap',
});

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
      <body className={`${montserrat.variable} font-sans`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            <StoreHydration />
            {children}
            <Toaster />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
