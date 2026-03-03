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
          <Button 
            onClick={() => setGenerateOpen(true)}
            className="rounded-full px-4 sm:px-5 py-3 sm:py-6 h-auto shadow-lg shadow-primary/20 transition-all hover:scale-105 active:scale-95 flex items-center gap-2 text-sm sm:text-base font-bold w-full sm:w-auto justify-center"
          >
            <Plus className="h-4 w-4 sm:h-5 sm:w-5" />
            Generate Sheet
          </Button>
        }
      />
      <SheetList />
      <SheetGenerate open={generateOpen} onOpenChange={setGenerateOpen} />
    </>
  );
}
