/**
 * One-time backfill for the Communication Center's per-customer redesign
 * (Conversation re-keyed from one-per-DailySheetItem to one-per-customer,
 * 2026-07-17). Run BEFORE applying the schema migration that adds the
 * `@@unique([vendorId, customerId])` constraint on Conversation — that
 * constraint will fail to apply while duplicate rows exist.
 *
 * For every (vendorId, customerId) with more than one Conversation row:
 *   1. Pick the survivor = earliest `createdAt` (arbitrary but stable; all
 *      rollups get recomputed below regardless of which row survives).
 *   2. Re-parent every ConversationMessage from the other rows onto the survivor.
 *   3. Re-parent ConversationRead rows onto the survivor, keeping MAX(lastReadAt)
 *      per userId when the same user has watermarks in more than one source row
 *      (unique constraint is [conversationId, userId] — must dedupe first).
 *   4. Recompute the survivor's rollups (lastMessageAt/Preview/Sender*,
 *      messageCount, dailySheetItemId/dailySheetId/vanId/driverId/deliveryDate)
 *      from the full merged message set.
 *   5. status = status of whichever source row had the latest lastMessageAt.
 *   6. Delete the non-survivor rows.
 *
 * Idempotent: safe to re-run — a vendor/customer pair with 0 or 1 rows is a
 * no-op. No dry-run mode (existing conversation data isn't considered
 * critical — direct-apply per owner decision).
 *
 * Run: node merge-conversations-per-customer.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const groups = await prisma.$queryRawUnsafe(`
    SELECT "vendorId", "customerId", COUNT(*) AS cnt
    FROM "Conversation"
    GROUP BY 1, 2
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
  `);

  if (groups.length === 0) {
    console.log('No duplicate per-customer Conversation rows found. Nothing to do.');
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${groups.length} customer(s) with duplicate conversation rows. Merging...`);

  let merged = 0;
  for (const { vendorId, customerId } of groups) {
    await prisma.$transaction(async (tx) => {
      const rows = await tx.conversation.findMany({
        where: { vendorId, customerId },
        orderBy: { createdAt: 'asc' },
      });
      if (rows.length <= 1) return;

      const survivor = rows[0];
      const others = rows.slice(1);
      const otherIds = others.map((r) => r.id);

      // Re-parent messages.
      await tx.conversationMessage.updateMany({
        where: { conversationId: { in: otherIds } },
        data: { conversationId: survivor.id },
      });

      // Re-parent read watermarks, keeping MAX(lastReadAt) per user to avoid
      // colliding with the survivor's own [conversationId, userId] unique rows.
      const allReads = await tx.conversationRead.findMany({
        where: { conversationId: { in: [survivor.id, ...otherIds] } },
      });
      const bestByUser = new Map();
      for (const r of allReads) {
        const existing = bestByUser.get(r.userId);
        if (!existing || r.lastReadAt > existing.lastReadAt) bestByUser.set(r.userId, r);
      }
      await tx.conversationRead.deleteMany({ where: { conversationId: { in: [survivor.id, ...otherIds] } } });
      for (const [userId, r] of bestByUser) {
        await tx.conversationRead.create({
          data: { conversationId: survivor.id, userId, lastReadAt: r.lastReadAt },
        });
      }

      // Recompute rollups from the full merged message set.
      const messages = await tx.conversationMessage.findMany({
        where: { conversationId: survivor.id, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        include: {
          createdBy: { select: { role: true } },
          item: { select: { dailySheetId: true, dailySheet: { select: { vanId: true, driverId: true, date: true } } } },
        },
      });
      const messageCount = messages.length;
      const latest = messages[messages.length - 1] ?? null;
      const latestSourceRow = [...rows].sort(
        (a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0),
      )[0];

      await tx.conversation.update({
        where: { id: survivor.id },
        data: {
          messageCount,
          lastMessageAt: latest?.createdAt ?? null,
          lastMessagePreview:
            latest == null
              ? null
              : latest.type === 'VOICE'
                ? '🎤 Voice message'
                : (latest.text ?? '').slice(0, 120),
          lastMessageSenderId: latest?.createdById ?? null,
          // Fall back to the survivor's own pre-merge values (never null under
          // the pre-migration NOT NULL schema) rather than writing null when
          // every duplicate row in this group has zero real messages — keeps
          // this script safe to run before OR after the schema migration.
          lastMessageSenderRole: latest?.createdBy?.role ?? survivor.lastMessageSenderRole,
          dailySheetItemId: latest?.dailySheetItemId ?? survivor.dailySheetItemId,
          dailySheetId: latest?.item?.dailySheetId ?? survivor.dailySheetId,
          vanId: latest?.item?.dailySheet?.vanId ?? survivor.vanId,
          driverId: latest?.item?.dailySheet?.driverId ?? survivor.driverId,
          deliveryDate: latest?.item?.dailySheet?.date ?? survivor.deliveryDate,
          status: latestSourceRow.status,
        },
      });

      await tx.conversation.deleteMany({ where: { id: { in: otherIds } } });
      merged += otherIds.length;
    });
  }

  console.log(`Done. Merged away ${merged} duplicate conversation row(s) across ${groups.length} customer(s).`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
