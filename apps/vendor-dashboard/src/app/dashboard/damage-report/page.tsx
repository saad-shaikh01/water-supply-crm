'use client';

import { Suspense } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@water-supply-crm/ui';
import { DamageReportForm } from '../../../features/driver/components/damage-report-form';
import { MyDamageCases } from '../../../features/driver/components/my-damage-cases';

export default function DamageReportPage() {
  return (
    <Suspense>
      <div className="space-y-6 max-w-2xl">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10">
            <ShieldAlert className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Damage Report</h1>
            <p className="text-sm text-muted-foreground">
              Report a damaged bottle or view your past cases
            </p>
          </div>
        </div>

        <Tabs defaultValue="report" className="w-full">
          <TabsList className="w-full rounded-xl h-11 bg-card/40 border border-border/50">
            <TabsTrigger value="report" className="flex-1 rounded-lg font-semibold text-sm">
              Report New Damage
            </TabsTrigger>
            <TabsTrigger value="cases" className="flex-1 rounded-lg font-semibold text-sm">
              My Cases
            </TabsTrigger>
          </TabsList>

          <TabsContent value="report" className="mt-6">
            <DamageReportForm />
          </TabsContent>

          <TabsContent value="cases" className="mt-6">
            <MyDamageCases />
          </TabsContent>
        </Tabs>
      </div>
    </Suspense>
  );
}
