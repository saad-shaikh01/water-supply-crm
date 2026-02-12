import type { Metadata } from 'next';
import { QueryProvider } from '@water-supply-crm/data-access';
import { Toaster } from '@water-supply-crm/ui';
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
    <html lang="en">
      <body>
        <QueryProvider>
          {children}
          <Toaster />
        </QueryProvider>
      </body>
    </html>
  );
}
