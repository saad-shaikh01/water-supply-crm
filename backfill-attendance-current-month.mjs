/**
 * Backfill StaffAttendance PRESENT/CREW_CONFIRM rows for DailySheets that are
 * already crewConfirmed=true but have zero attendance rows for their driver/
 * crew (root cause: attendance is only captured by a POST /confirm-crew call,
 * and the confirm-crew dialog only auto-opens for an UNCONFIRMED sheet — once
 * a sheet is already confirmed there is no UI path left to re-fire that call,
 * so any sheet that reached crewConfirmed=true without the capture hook
 * running stays permanently attendance-less).
 *
 * Scope: current calendar month only (Asia/Karachi), every vendor.
 * Idempotent & safe to re-run: only creates a row where (userId, date) has
 * none; skips a date already LOCKED/SETTLED for that employee's payroll —
 * mirrors StaffAttendanceService.captureForConfirmedCrew's guards exactly.
 *
 * Run:  node backfill-attendance-current-month.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL'] } } });

function startOfUtcDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// "Current month" in Asia/Karachi (UTC+5, no DST) — shift "now" to Karachi
// local time before taking the 1st of that month.
function karachiMonthStart() {
  const nowKarachi = new Date(Date.now() + 5 * 60 * 60 * 1000);
  return new Date(Date.UTC(nowKarachi.getUTCFullYear(), nowKarachi.getUTCMonth(), 1));
}

async function isDateInLockedPeriod(vendorId, userId, date) {
  const period = await prisma.payrollPeriod.findFirst({
    where: { vendorId, startDate: { lte: date }, endDate: { gte: date } },
    select: { id: true },
  });
  if (!period) return false;
  const entry = await prisma.payrollEntry.findUnique({
    where: { periodId_userId: { periodId: period.id, userId } },
    select: { status: true },
  });
  return entry?.status === 'LOCKED' || entry?.status === 'SETTLED';
}

async function main() {
  const monthStart = karachiMonthStart();
  const now = new Date();

  console.log('\n🔁 Attendance backfill — current month\n');
  console.log(`  Window: ${monthStart.toISOString().slice(0, 10)} → ${now.toISOString().slice(0, 10)}\n`);

  const sheets = await prisma.dailySheet.findMany({
    where: {
      kind: { not: 'WALK_IN' },
      crewConfirmed: true,
      date: { gte: monthStart, lte: now },
    },
    select: {
      id: true,
      vendorId: true,
      date: true,
      driverId: true,
      crewConfirmedById: true,
      crew: { select: { userId: true } },
    },
    orderBy: { date: 'asc' },
  });

  console.log(`  Confirmed sheets in window: ${sheets.length}\n`);

  let sheetsTouched = 0;
  let created = 0;
  let alreadyPresent = 0;
  let skippedLocked = 0;
  let skippedInvalidUser = 0;

  for (const sheet of sheets) {
    const day = startOfUtcDay(sheet.date);
    const rosterIds = [sheet.driverId, ...sheet.crew.map((c) => c.userId)];
    const actorId = sheet.crewConfirmedById ?? sheet.driverId;

    const users = await prisma.user.findMany({
      where: { id: { in: rosterIds }, vendorId: sheet.vendorId },
      select: { id: true, isSystem: true },
    });
    const validIds = new Set(users.filter((u) => !u.isSystem).map((u) => u.id));

    let touchedThisSheet = false;

    for (const userId of rosterIds) {
      if (!validIds.has(userId)) {
        skippedInvalidUser++;
        continue;
      }

      const existing = await prisma.staffAttendance.findUnique({
        where: { userId_date: { userId, date: day } },
      });
      if (existing) {
        alreadyPresent++;
        continue;
      }

      if (await isDateInLockedPeriod(sheet.vendorId, userId, day)) {
        skippedLocked++;
        continue;
      }

      try {
        await prisma.staffAttendance.create({
          data: {
            vendorId: sheet.vendorId,
            userId,
            date: day,
            status: 'PRESENT',
            source: 'CREW_CONFIRM',
            dailySheetId: sheet.id,
            markedById: actorId,
          },
        });
        created++;
        touchedThisSheet = true;
      } catch (err) {
        if (err?.code !== 'P2002') throw err;
        alreadyPresent++;
      }
    }
    if (touchedThisSheet) sheetsTouched++;
  }

  console.log('═══════════════════════════════════════════');
  console.log('  ✅ ATTENDANCE BACKFILL COMPLETE');
  console.log('───────────────────────────────────────────');
  console.log(`  Sheets scanned:           ${sheets.length}`);
  console.log(`  Sheets with new rows:     ${sheetsTouched}`);
  console.log(`  Attendance rows created:  ${created}`);
  console.log(`  Already had a row:        ${alreadyPresent}`);
  console.log(`  Skipped (locked period):  ${skippedLocked}`);
  console.log(`  Skipped (invalid/system user): ${skippedInvalidUser}`);
  console.log('═══════════════════════════════════════════\n');
}

main()
  .catch((e) => {
    console.error('❌ Backfill failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
