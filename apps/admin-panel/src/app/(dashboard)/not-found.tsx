import Link from 'next/link';
import { Button } from '@water-supply-crm/ui';
import { PageHeader } from '../../components/shared/page-header';
import { EmptyState } from '../../components/shared/empty-state';

export default function DashboardNotFound() {
  return (
    <div className="space-y-6">
      <PageHeader title="Page not found" />
      <EmptyState
        title="We could not find that page"
        description="It may have been moved or removed."
        action={
          <Button asChild>
            <Link href="/">Back to Overview</Link>
          </Button>
        }
      />
    </div>
  );
}
