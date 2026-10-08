'use client';

import Link from 'next/link';
import { CheckCircle2, Circle, CircleAlert, Loader2, Rocket } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@water-supply-crm/ui';
import { useCan } from '../../authz/hooks/use-can';
import { useAuthStore } from '../../../store/auth.store';
import { useGoLive, useReadiness } from '../hooks/use-onboarding';

/**
 * "Ready to go live" checklist for a vendor that has not gone live yet. Renders nothing for a live vendor
 * (existing vendors such as Blue Ice never see it), for platform admins, or for roles without access.
 */
export function GoLiveChecklist() {
  const user = useAuthStore((s) => s.user);
  const canView = useCan('company_profile:view');
  const canUpdate = useCan('company_profile:update');
  const enabled = !!user && user.role !== 'SUPER_ADMIN' && canView;
  const { data, isLoading } = useReadiness(enabled);
  const goLive = useGoLive();

  if (!enabled || isLoading || !data || data.live) return null;

  const required = data.items.filter((i) => i.required);
  const done = required.filter((i) => i.status === 'DONE').length;

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Rocket className="h-4 w-4 text-primary" /> Get ready to go live
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
            {done} of {required.length} required steps done
          </span>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Until you go live, nothing is sent to your customers on WhatsApp — so you can set everything up and import your data safely.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.items.map((item) => (
          <div key={item.key} className="flex items-start gap-3 rounded-lg border border-border/50 p-3">
            {item.status === 'DONE' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            ) : item.status === 'WARN' ? (
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            ) : (
              <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {item.label} {!item.required && <span className="ml-1 text-[10px] font-normal uppercase text-muted-foreground">recommended</span>}
              </p>
              <p className="text-xs text-muted-foreground">{item.detail}</p>
            </div>
            {item.status !== 'DONE' && (
              <Button asChild variant="outline" size="sm">
                <Link href={item.link}>Open</Link>
              </Button>
            )}
          </div>
        ))}
        {canUpdate && (
          <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {data.ready ? 'Everything required is done. Going live enables WhatsApp messages to your customers.' : 'Finish the required steps to enable "Go live".'}
            </p>
            <Button type="button" disabled={!data.ready || goLive.isPending} onClick={() => goLive.mutate()}>
              {goLive.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Rocket className="mr-1.5 h-4 w-4" />} Go live
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
