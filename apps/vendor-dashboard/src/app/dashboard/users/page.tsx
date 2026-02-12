'use client';

import { useState } from 'react';
import { Button } from '@water-supply-crm/ui';
import { Plus } from 'lucide-react';
import { PageHeader } from '../../../components/shared/page-header';
import { UserList } from '../../../features/users/components/user-list';
import { UserForm } from '../../../features/users/components/user-form';

export default function UsersPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [editUser, setEditUser] = useState<Record<string, unknown> | null>(null);

  return (
    <>
      <PageHeader
        title="Team Members"
        description="Manage staff and driver accounts"
        action={
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add User
          </Button>
        }
      />
      <UserList onEdit={(u) => { setEditUser(u); setFormOpen(true); }} />
      <UserForm
        open={formOpen}
        onOpenChange={(o) => { setFormOpen(o); if (!o) setEditUser(null); }}
        user={editUser}
      />
    </>
  );
}
