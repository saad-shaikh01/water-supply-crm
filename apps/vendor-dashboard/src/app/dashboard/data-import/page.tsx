'use client';

import Link from 'next/link';
import { Upload } from 'lucide-react';
import { Button } from '@water-supply-crm/ui';
import { PageHeader } from '../../../components/shared/page-header';
import { useCan } from '../../../features/authz/hooks/use-can';
import { DATA_IMPORT_PERMISSIONS } from '../../../features/data-import/constants';
import { ImportHistory } from '../../../features/data-import/components/import-history';
import { GoLiveChecklist } from '../../../features/onboarding/components/go-live-checklist';

export default function DataImportPage() {
  const canUpload = useCan(DATA_IMPORT_PERMISSIONS.upload);
  return (
    <>
      <PageHeader
        title="Data Import"
        description="Onboard your existing customers and their opening balances from your own Excel or CSV. Review everything before anything is saved."
        action={
          canUpload ? (
            <Button asChild className="rounded-full px-4 sm:px-5 py-3 sm:py-6 h-auto shadow-lg shadow-primary/20 transition-all hover:scale-105 active:scale-95 flex items-center gap-2 text-sm sm:text-base font-bold w-full sm:w-auto justify-center">
              <Link href="/dashboard/data-import/new"><Upload className="h-4 w-4 sm:h-5 sm:w-5" /> New import</Link>
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-6 pb-4">
        <GoLiveChecklist />
        <ImportHistory />
      </div>
    </>
  );
}
