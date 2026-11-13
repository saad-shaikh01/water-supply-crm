import Link from 'next/link';
import { Button } from '@water-supply-crm/ui';
import { EmptyState } from '../components/shared/empty-state';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <EmptyState
          title="Page not found"
          description="The page you are looking for does not exist."
          action={
            <Button asChild>
              <Link href="/">Go to Overview</Link>
            </Button>
          }
        />
      </div>
    </div>
  );
}
