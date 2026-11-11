'use client';

import { PageHeader } from '../../../components/shared/page-header';
import { TwoFactorCard } from './two-factor-card';
import { SessionsCard } from './sessions-card';

export function SecurityPageClient() {
  return (
    <div className="space-y-6">
      <PageHeader title="Security" description="Two-factor authentication and active sessions for your account" />
      <TwoFactorCard />
      <SessionsCard />
    </div>
  );
}
