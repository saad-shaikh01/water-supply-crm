'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { PageHeader } from '../../../components/shared/page-header';
import { PlansTab } from './plans-tab';
import { SubscriptionsTab } from './subscriptions-tab';
import { InvoicesTab } from './invoices-tab';

const TABS = [
  { id: 'plans', label: 'Plans' },
  { id: 'subscriptions', label: 'Subscriptions' },
  { id: 'invoices', label: 'Invoices' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function BillingPageClient() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const raw = search.get('tab');
  const tab: TabId = TABS.some((t) => t.id === raw) ? (raw as TabId) : 'plans';

  // Each tab owns its filter keys; switching tabs starts from a clean query string.
  const select = (id: TabId) => router.replace(`${pathname}?tab=${id}`, { scroll: false });

  return (
    <div className="space-y-6">
      <PageHeader title="Billing" description="Plans, vendor subscriptions and manually recorded invoices" />
      <div role="tablist" aria-label="Billing sections" className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => select(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'plans' && <PlansTab />}
        {tab === 'subscriptions' && <SubscriptionsTab />}
        {tab === 'invoices' && <InvoicesTab />}
      </div>
    </div>
  );
}
