'use client';

import { useState } from 'react';
import { Button } from '@water-supply-crm/ui';
import { Plus } from 'lucide-react';
import { PageHeader } from '../../../components/shared/page-header';
import { SheetList } from '../../../features/daily-sheets/components/sheet-list';
import { SheetGenerate } from '../../../features/daily-sheets/components/sheet-generate';

export default function DailySheetsPage() {
  const [generateOpen, setGenerateOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Daily Sheets"
        description="Manage daily delivery operations"
        action={
          <Button onClick={() => setGenerateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Generate Sheet
          </Button>
        }
      />
      <SheetList />
      <SheetGenerate open={generateOpen} onOpenChange={setGenerateOpen} />
    </>
  );
}
