import { QueryProvider } from '@water-supply-crm/data-access';
import './global.css';

export const metadata = {
  title: 'Water Supply CRM - Admin Panel',
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
        </QueryProvider>
      </body>
    </html>
  );
}
