import { PageHeader } from '../../../components/shared/page-header';
import { AuditLogList } from '../../../features/audit-logs/components/audit-log-list';

export default function AuditLogsPage() {
  return (
    <>
      <PageHeader
        title="Audit Logs"
        description="Track all changes made by users across the system"
      />
      <AuditLogList />
    </>
  );
}
