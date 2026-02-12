import { QueryProvider } from '@water-supply-crm/data-access';
import { Toaster } from '@water-supply-crm/ui';
import './global.css';

export const metadata = {
  title: 'WaterCRM — Customer Portal',
  description: 'View your wallet balance and transaction history',
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
