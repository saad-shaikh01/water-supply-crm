import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { userAccessApi, type UserEffectiveAccess, type OverrideInput } from '../api/user-access.api';
import { queryKeys } from '../../../lib/query-keys';
import { useInvalidatePermissions } from '../../authz/hooks/use-permissions';
import type { RoleSummary } from '../../roles/api/roles.api';

/** The user's currently assigned RBAC role (+ effective permissions), for the Edit User sheet. */
export const useUserAccess = (userId: string | null) =>
  useQuery({
    queryKey: queryKeys.users.access(userId ?? ''),
    queryFn: () => userAccessApi.getEffective(userId as string).then((r) => r.data),
    enabled: !!userId,
  });

/**
 * Assigns a role via the dedicated `PATCH /users/:id/role` endpoint — kept separate from
 * the general user-details `PATCH /users/:id` save, matching the backend's own separation
 * (`UserAccessController` vs `UserController`). Optimistically updates the displayed role
 * so the select reflects the change immediately; rolls back on failure. Always refreshes
 * the target user's access query and the roles list (member counts change), and invalidates
 * the current viewer's own `/auth/me` in case they just reassigned their own role.
 */
export const useAssignRole = () => {
  const queryClient = useQueryClient();
  const invalidatePermissions = useInvalidatePermissions();

  return useMutation({
    mutationFn: ({ userId, roleId }: { userId: string; roleId: string }) =>
      userAccessApi.assignRole(userId, roleId),
    onMutate: async ({ userId, roleId }) => {
      const key = queryKeys.users.access(userId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<UserEffectiveAccess>(key);
      const roles = queryClient.getQueryData<RoleSummary[]>(queryKeys.roles.all());
      const nextRole = roles?.find((r) => r.id === roleId);

      if (previous && nextRole) {
        queryClient.setQueryData<UserEffectiveAccess>(key, {
          ...previous,
          role: { id: nextRole.id, key: nextRole.key, name: nextRole.name },
        });
      }
      return { previous, userId };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.users.access(context.userId), context.previous);
      }
      toast.error('Failed to assign role');
    },
    onSuccess: () => toast.success('Role updated'),
    onSettled: (_data, _err, { userId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.access(userId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.roles.all() });
      invalidatePermissions();
    },
  });
};

/**
 * Full-replacement save for a user's permission overrides (`PATCH /users/:id/overrides`).
 * Optimistically reflects the new `overrides` array so the active-overrides list and the
 * Allow/Deny matrices update immediately; rolls back on failure. Deliberately does NOT
 * optimistically recompute `permissions`/`pagePermissions` — that's the backend's ALLOW/DENY
 * resolution algorithm, which the frontend must not duplicate. The "Effective Permissions"
 * view stays at its last-confirmed value until `onSettled` refetches the real resolved set.
 */
export const useSetOverrides = () => {
  const queryClient = useQueryClient();
  const invalidatePermissions = useInvalidatePermissions();

  return useMutation({
    mutationFn: ({ userId, overrides }: { userId: string; overrides: OverrideInput[] }) =>
      userAccessApi.setOverrides(userId, overrides),
    onMutate: async ({ userId, overrides }) => {
      const key = queryKeys.users.access(userId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<UserEffectiveAccess>(key);

      if (previous) {
        queryClient.setQueryData<UserEffectiveAccess>(key, {
          ...previous,
          overrides: overrides.map((o) => ({ ...o, expiresAt: o.expiresAt ?? null })),
        });
      }
      return { previous, userId };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.users.access(context.userId), context.previous);
      }
      toast.error('Failed to save permission overrides');
    },
    onSuccess: () => toast.success('Permission overrides updated'),
    onSettled: (_data, _err, { userId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.access(userId) });
      invalidatePermissions();
    },
  });
};
