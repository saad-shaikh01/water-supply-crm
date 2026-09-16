/**
 * Diagnose why a confirmed DailySheet produced zero StaffAttendance rows.
 * Re-runs the exact same checks StaffAttendanceService.captureForConfirmedCrew
 * uses, read-only, and prints which check is skipping each roster member.
 *
 * Run:  node diagnose-attendance-gap.mjs [YYYY-MM-DD]
 * (defaults to today, UTC)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL'] } } });

function startOfUtcDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function main() {
  const dateArg = process.argv[2];
  const targetDate = dateArg ? new Date(`${dateArg}T00:00:00.000Z`) : startOfUtcDay(new Date());
  const dayStart = targetDate;
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

  console.log(`\n🔎 Diagnosing attendance gap for ${dayStart.toISOString().slice(0, 10)}\n`);

  const sheets = await prisma.dailySheet.findMany({
    where: {
      kind: { not: 'WALK_IN' },
      crewConfirmed: true,
      date: { gte: dayStart, lte: dayEnd },
    },
    select: {
      id: true,
      vendorId: true,
      date: true,
      driverId: true,
      crewConfirmedAt: true,
      crewConfirmedById: true,
      van: { select: { plateNumber: true } },
      crew: { select: { userId: true, role: true } },
    },
    orderBy: { date: 'asc' },
  });

  if (sheets.length === 0) {
    console.log('  No crewConfirmed=true, non-WALK_IN sheets found for this date. Nothing to diagnose.\n');
    return;
  }

  for (const sheet of sheets) {
    console.log('───────────────────────────────────────────');
    console.log(`  Sheet: ${sheet.id}  (van ${sheet.van?.plateNumber ?? '?'})`);
    console.log(`  vendorId: ${sheet.vendorId}`);
    console.log(`  date (raw): ${sheet.date.toISOString()}`);
    console.log(`  crewConfirmedAt: ${sheet.crewConfirmedAt?.toISOString() ?? 'null'}`);
    console.log(`  crewConfirmedById: ${sheet.crewConfirmedById ?? 'null'}`);

    const day = startOfUtcDay(sheet.date);
    const rosterIds = [sheet.driverId, ...sheet.crew.map((c) => c.userId)];

    const users = await prisma.user.findMany({
      where: { id: { in: rosterIds } },
      select: { id: true, name: true, role: true, vendorId: true, isActive: true, isSystem: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    for (const userId of rosterIds) {
      const u = byId.get(userId);
      console.log(`\n  Roster member ${userId}`);
      if (!u) {
        console.log('    ❌ User not found at all (dangling reference).');
        continue;
      }
      console.log(`    name=${u.name} role=${u.role} isActive=${u.isActive} isSystem=${u.isSystem} vendorId=${u.vendorId}`);
      if (u.vendorId !== sheet.vendorId) {
        console.log(`    ❌ TENANCY MISMATCH — user.vendorId (${u.vendorId}) !== sheet.vendorId (${sheet.vendorId}). captureForConfirmedCrew's tenancy filter would DROP this user silently.`);
      }
      if (u.isSystem) {
        console.log('    ❌ isSystem=true — skipped by design (sentinel user).');
      }

      const existing = await prisma.staffAttendance.findUnique({
        where: { userId_date: { userId, date: day } },
      });
      console.log(`    StaffAttendance row for (userId, ${day.toISOString().slice(0, 10)}): ${existing ? `EXISTS (id=${existing.id}, status=${existing.status}, source=${existing.source})` : 'NONE'}`);

      const period = await prisma.payrollPeriod.findFirst({
        where: { vendorId: sheet.vendorId, startDate: { lte: day }, endDate: { gte: day } },
        select: { id: true, periodLabel: true, status: true },
      });
      if (!period) {
        console.log('    PayrollPeriod covering this date: none.');
      } else {
        console.log(`    PayrollPeriod: ${period.periodLabel} (status=${period.status})`);
        const entry = await prisma.payrollEntry.findUnique({
          where: { periodId_userId: { periodId: period.id, userId } },
          select: { status: true },
        });
        if (entry) {
          console.log(`    PayrollEntry for this user in that period: status=${entry.status}`);
          if (entry.status === 'LOCKED' || entry.status === 'SETTLED') {
            console.log('    ❌ LOCKED/SETTLED — isDateInLockedPeriod() would return true, silently skipping this user.');
          }
        } else {
          console.log('    PayrollEntry for this user in that period: none.');
        }
      }
    }
    console.log();
  }
}

main()
  .catch((e) => {
    console.error('❌ Diagnostic failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
