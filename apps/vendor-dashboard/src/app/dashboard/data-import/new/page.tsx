'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '../../../../components/shared/page-header';
import { useCan } from '../../../../features/authz/hooks/use-can';
import { DATA_IMPORT_PERMISSIONS } from '../../../../features/data-import/constants';
import { UploadStep } from '../../../../features/data-import/components/upload-step';

export default function NewImportPage() {
  const canUpload = useCan(DATA_IMPORT_PERMISSIONS.upload);
  return (
    <>
      <Link href="/dashboard/data-import" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-4 w-4" /> All imports
      </Link>
      <PageHeader title="Import customers" description="Step 1 of 4 — upload your file. Nothing is saved until you confirm at the end." />
      {canUpload ? <UploadStep /> : <p className="text-sm text-muted-foreground">You don&apos;t have permission to upload import files.</p>}
    </>
  );
}
