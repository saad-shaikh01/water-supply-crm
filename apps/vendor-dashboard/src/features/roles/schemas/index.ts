import { z } from 'zod';

/** Mirrors `CreateRoleDto`/`UpdateRoleDto` field constraints (name/description/color only —
 * the permission set is edited separately, once the Permission Matrix checkpoint lands). */
export const roleSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(50),
  description: z.string().max(200).optional().or(z.literal('')),
  color: z.string().max(20).optional().or(z.literal('')),
});

export type RoleInput = z.infer<typeof roleSchema>;

export const cloneRoleSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(50),
  description: z.string().max(200).optional().or(z.literal('')),
});

export type CloneRoleFormInput = z.infer<typeof cloneRoleSchema>;
