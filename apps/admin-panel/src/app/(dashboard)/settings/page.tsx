import { PageHeader } from '../../../components/shared/page-header';
import { EmptyState } from '../../../components/shared/empty-state';

// Placeholder - owned by the Settings phase after Phase 1 merges.
export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />
      <EmptyState title="Platform settings are coming soon" />
    </div>
  );
}
