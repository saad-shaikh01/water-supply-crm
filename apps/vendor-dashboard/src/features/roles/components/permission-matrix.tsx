'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, AlertCircle } from 'lucide-react';
import {
  Input, Label, Badge, Skeleton,
  Accordion, AccordionItem, AccordionTrigger, AccordionContent,
} from '@water-supply-crm/ui';
import { cn } from '@water-supply-crm/ui';
import type { Permission } from '@water-supply-crm/authz';
import { usePermissionCatalog } from '../hooks/use-permission-catalog';

interface PermissionMatrixProps {
  /** Currently selected permissions — the full, authoritative set (controlled). */
  selected: ReadonlySet<Permission>;
  onChange: (next: Set<Permission>) => void;
  /** Shows an advisory note — system roles are usually edited via "Reset to preset" instead. */
  isSystem?: boolean;
  disabled?: boolean;
}

/**
 * Renders the frozen permission catalog (`GET /permissions`) as a resource-grouped,
 * collapsible checklist. This is the single permission-editing surface — the Role Editor
 * (and, later, the User Overrides screen) both drive it purely through `selected`/`onChange`.
 */
export function PermissionMatrix({ selected, onChange, isSystem, disabled }: PermissionMatrixProps) {
  const { data: groups, isLoading, isError } = usePermissionCatalog();
  const [search, setSearch] = useState('');

  const filteredGroups = useMemo(() => {
    if (!groups) return [];
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((group) => ({
        ...group,
        permissions: group.permissions.filter(
          (p) =>
            p.key.toLowerCase().includes(q) ||
            p.label.toLowerCase().includes(q) ||
            group.label.toLowerCase().includes(q),
        ),
      }))
      .filter((group) => group.permissions.length > 0);
  }, [groups, search]);

  // Accordion is controlled so a search match reliably expands its group on every
  // keystroke — an uncontrolled `defaultValue` only applies once, at mount.
  const [openItems, setOpenItems] = useState<string[]>([]);
  useEffect(() => {
    if (search.trim()) setOpenItems(filteredGroups.map((g) => g.resource));
  }, [search, filteredGroups]);

  const toggleOne = (permission: Permission, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(permission);
    else next.delete(permission);
    onChange(next);
  };

  const setGroup = (permissions: Permission[], checked: boolean) => {
    const next = new Set(selected);
    for (const p of permissions) {
      if (checked) next.add(p);
      else next.delete(p);
    }
    onChange(next);
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive p-4 rounded-xl border border-destructive/20 bg-destructive/5">
        <AlertCircle className="h-4 w-4 flex-shrink-0" />
        Failed to load the permission catalog. Close and reopen this form to retry.
      </div>
    );
  }

  if (!groups || groups.length === 0) {
    return <p className="text-sm text-muted-foreground">No permissions are defined.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Label>Permissions</Label>
        <span className="text-xs text-muted-foreground">{selected.size} selected</span>
      </div>

      {isSystem && (
        <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          This is a system role. Changes here save as customizations — use &ldquo;Reset to
          preset&rdquo; from the roles list to restore its original grants.
        </p>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search permissions..."
          className="pl-9"
          disabled={disabled}
        />
      </div>

      {filteredGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No permissions match &ldquo;{search}&rdquo;.
        </p>
      ) : (
        <Accordion
          type="multiple"
          value={openItems}
          onValueChange={setOpenItems}
          className="space-y-2 max-h-[420px] overflow-y-auto pr-1"
        >
          {filteredGroups.map((group) => {
            const keys = group.permissions.map((p) => p.key as Permission);
            const selectedCount = keys.filter((k) => selected.has(k)).length;
            const allSelected = selectedCount === keys.length && keys.length > 0;
            const pagePermission = group.permissions.find((p) => p.isPage);
            const actionPermissions = group.permissions.filter((p) => !p.isPage);

            return (
              <AccordionItem
                key={group.resource}
                value={group.resource}
                className="border border-border rounded-xl px-3 last:border-b"
              >
                <AccordionTrigger className="hover:no-underline py-3">
                  <div className="flex items-center justify-between flex-1 pr-3">
                    <span className="font-medium text-sm">{group.label}</span>
                    <Badge
                      variant={allSelected ? 'success' : selectedCount > 0 ? 'info' : 'outline'}
                      className="text-[10px]"
                    >
                      {selectedCount}/{keys.length}
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-3 space-y-2">
                  <div className="flex items-center gap-2 pb-2">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setGroup(keys, true)}
                      className="text-xs font-medium text-primary hover:underline disabled:opacity-50 disabled:no-underline"
                    >
                      Select all
                    </button>
                    <span className="text-muted-foreground/40">·</span>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setGroup(keys, false)}
                      className="text-xs font-medium text-muted-foreground hover:underline disabled:opacity-50 disabled:no-underline"
                    >
                      Clear all
                    </button>
                  </div>

                  {pagePermission && (
                    <label
                      className={cn(
                        'flex items-center gap-2 py-1.5 border-b border-border/50 mb-1',
                        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                      )}
                    >
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={selected.has(pagePermission.key as Permission)}
                        onChange={(e) => toggleOne(pagePermission.key as Permission, e.target.checked)}
                        className="h-4 w-4 rounded border-border accent-primary"
                      />
                      <span className="text-sm font-semibold">{pagePermission.label}</span>
                    </label>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                    {actionPermissions.map((perm) => (
                      <label
                        key={perm.key}
                        className={cn(
                          'flex items-center gap-2 py-1',
                          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                        )}
                      >
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={selected.has(perm.key as Permission)}
                          onChange={(e) => toggleOne(perm.key as Permission, e.target.checked)}
                          className="h-4 w-4 rounded border-border accent-primary"
                        />
                        <span className="text-sm">{perm.label}</span>
                      </label>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}
