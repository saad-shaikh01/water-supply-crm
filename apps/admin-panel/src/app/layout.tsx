import { QueryProvider } from '@water-supply-crm/data-access';
import { Toaster } from '@water-supply-crm/ui';
import './global.css';

export const metadata = {
  title: 'WaterCRM — Admin Panel',
  description: 'Platform administration for Water Supply CRM',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
