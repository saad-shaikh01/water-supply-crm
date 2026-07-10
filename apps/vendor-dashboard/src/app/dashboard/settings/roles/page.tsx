'use client';

import { useState } from 'react';
import { Button } from '@water-supply-crm/ui';
import { Plus } from 'lucide-react';
import { PageHeader } from '../../../../components/shared/page-header';
import { Can } from '../../../../features/authz/components/can';
import { RoleList } from '../../../../features/roles/components/role-list';
import { RoleForm } from '../../../../features/roles/components/role-form';
import { CloneRoleDialog } from '../../../../features/roles/components/clone-role-dialog';
import type { RoleSummary } from '../../../../features/roles/api/roles.api';

export default function RolesPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [editRole, setEditRole] = useState<RoleSummary | null>(null);
  const [cloneSource, setCloneSource] = useState<RoleSummary | null>(null);

  return (
    <Can permission="roles:page">
      <PageHeader
        title="Roles & Access Control"
        description="Manage the roles vendor staff use to sign in and what each one can access"
        action={
          <Can permission="roles:create">
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Role
            </Button>
          </Can>
        }
      />
      <RoleList
        onEdit={(r) => { setEditRole(r); setFormOpen(true); }}
        onClone={(r) => setCloneSource(r)}
      />
      <RoleForm
        open={formOpen}
        onOpenChange={(o) => { setFormOpen(o); if (!o) setEditRole(null); }}
        role={editRole}
      />
      <CloneRoleDialog
        open={!!cloneSource}
        onOpenChange={(o) => { if (!o) setCloneSource(null); }}
        source={cloneSource}
      />
    </Can>
  );
}
