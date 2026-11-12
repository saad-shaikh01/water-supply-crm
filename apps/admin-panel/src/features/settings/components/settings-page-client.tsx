'use client';

import Link from 'next/link';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@water-supply-crm/ui';
import { PageHeader } from '../../../components/shared/page-header';
import { ErrorState } from '../../../components/shared/error-state';
import { TableSkeleton } from '../../../components/shared/table-skeleton';
import { SETTING_KEYS } from '../api/settings.api';
import { usePlatformSettings } from '../hooks/use-platform-settings';
import { MaintenanceCard } from './maintenance-card';
import { SecurityPolicyCard } from './security-policy-card';
import { ToggleList } from './toggle-list';

export function SettingsPageClient() {
  const { data, isLoading, error, refetch } = usePlatformSettings();

  const flags = (data?.settings ?? []).filter((s) => s.key.startsWith('flags.'));
  const defaults = (data?.settings ?? []).filter((s) => s.key === SETTING_KEYS.defaultGrouping);

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Platform-wide configuration" />
      <nav aria-label="Settings sections" className="flex gap-4 text-sm">
        <Link href="/settings/admins" className="text-primary hover:underline">
          Platform administrators
        </Link>
        <Link href="/settings/security" className="text-primary hover:underline">
          My security (2FA and sessions)
        </Link>
      </nav>
      {isLoading ? (
        <TableSkeleton cols={2} />
      ) : error || !data ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <Tabs defaultValue="general">
          <div className="overflow-x-auto"><TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="flags">Feature flags</TabsTrigger>
            <TabsTrigger value="defaults">Defaults</TabsTrigger>
            <TabsTrigger value="security">Security policy</TabsTrigger>
          </TabsList></div>
          <TabsContent value="general" className="mt-4">
            <MaintenanceCard data={data} />
          </TabsContent>
          <TabsContent value="flags" className="mt-4">
            <ToggleList
              title="Feature flags"
              description="Switch platform features on or off."
              entries={flags}
              emptyText="No feature flags are defined yet."
            />
          </TabsContent>
          <TabsContent value="defaults" className="mt-4">
            <ToggleList
              title="Defaults for new vendors"
              description="Applies to newly created vendors only. Existing vendors are not changed."
              entries={defaults}
              emptyText="No defaults available."
              labels={{ [SETTING_KEYS.defaultGrouping]: 'Enable customer grouping' }}
            />
          </TabsContent>
          <TabsContent value="security" className="mt-4">
            <SecurityPolicyCard data={data} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
