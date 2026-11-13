-- P3 observability: additive, index-only migration for cross-vendor AuditLog queries.
-- NOTE: Prisma migrate cannot use CREATE INDEX CONCURRENTLY. On a very large production
-- "AuditLog" table, review lock time and apply during low traffic (or pre-create the
-- indexes manually with CONCURRENTLY using these exact names; IF NOT EXISTS keeps this safe).

CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_entity_createdAt_idx" ON "AuditLog"("entity", "createdAt");
