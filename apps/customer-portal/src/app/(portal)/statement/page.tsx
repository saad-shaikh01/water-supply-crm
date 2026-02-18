'use client';

import { useState } from 'react';
import { FileText, Download } from 'lucide-react';
import { Card, CardContent, Button } from '@water-supply-crm/ui';
import { downloadStatement } from '../../../features/deliveries/hooks/use-deliveries';

const MONTHS = Array.from({ length: 6 }, (_, i) => {
  const d = new Date();
  d.setMonth(d.getMonth() - i);
  return {
    value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    label: d.toLocaleDateString('en-PK', { month: 'long', year: 'numeric' }),
  };
});

export default function StatementPage() {
  const [selectedMonth, setSelectedMonth] = useState(MONTHS[0].value);
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    setIsDownloading(true);
    await downloadStatement(selectedMonth);
    setIsDownloading(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
          <FileText className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-black tracking-tight">Statement</h1>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Monthly Account Summary</p>
        </div>
      </div>

      <Card className="bg-card/50 backdrop-blur-sm border-border/50">
        <CardContent className="p-6 space-y-6">
          <div className="space-y-3">
            <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest text-[11px]">Select Month</p>
            <div className="grid grid-cols-2 gap-2">
              {MONTHS.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setSelectedMonth(m.value)}
                  className={`p-3 rounded-xl text-sm font-bold text-left transition-all border ${
                    selectedMonth === m.value
                      ? 'bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/20'
                      : 'bg-accent/30 border-border/50 text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <Button
            onClick={handleDownload}
            disabled={isDownloading}
            className="w-full rounded-xl font-bold h-12 shadow-lg shadow-primary/20"
          >
            <Download className="mr-2 h-4 w-4" />
            {isDownloading ? 'Generating...' : 'Download PDF Statement'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
