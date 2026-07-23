#!/usr/bin/env node
// scripts/inspect-balance-reminder-schedule.mjs
//
// Diagnostic + emergency-stop tool for the "balance-reminders" BullMQ queue.
// Shows exactly what cron jobs BullMQ has queued right now — independent of
// what the ReminderScheduleConfig table / dashboard UI says (they can drift
// apart when a repeatable job created via the old add({repeat}) API fails
// to get removed).
//
// Usage (run from the repo root, same host as the API / same Redis):
//   node scripts/inspect-balance-reminder-schedule.mjs                # list only
//   node scripts/inspect-balance-reminder-schedule.mjs --remove-all   # emergency stop: removes every job in this queue
//
// REDIS_URL env var is optional — defaults to redis://127.0.0.1:6379
// (matches the prod infraOverrides in ecosystem.config.js).

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const QUEUE_NAME = 'balance-reminders';

async function main() {
  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE_NAME, { connection });

  const repeatable = await queue.getRepeatableJobs();
  const schedulers = await queue.getJobSchedulers();

  console.log(`\nRedis: ${REDIS_URL}`);
  console.log(`Queue: ${QUEUE_NAME}\n`);

  console.log(`getRepeatableJobs() -> ${repeatable.length} entr${repeatable.length === 1 ? 'y' : 'ies'}`);
  for (const j of repeatable) {
    const isLegacy = j.key !== j.id;
    console.log(
      `  - id=${j.id}  key=${j.key}  pattern=${j.pattern}  tz=${j.tz ?? '(server-local)'}  ` +
      `next=${j.next ? new Date(j.next).toISOString() : 'n/a'}` +
      (isLegacy ? '   <-- LEGACY add({repeat}) job, not the new scheduler' : ''),
    );
  }

  console.log(`\ngetJobSchedulers() -> ${schedulers.length} entr${schedulers.length === 1 ? 'y' : 'ies'}`);
  for (const s of schedulers) {
    console.log(
      `  - id=${s.id}  pattern=${s.pattern}  tz=${s.tz ?? '(server-local)'}  ` +
      `next=${s.next ? new Date(s.next).toISOString() : 'n/a'}`,
    );
  }

  if (repeatable.length === 0 && schedulers.length === 0) {
    console.log('\nNo balance-reminder cron jobs are queued — nothing will fire automatically.');
  }

  if (process.argv.includes('--remove-all')) {
    console.log('\n--remove-all passed — removing every job found above...');
    for (const j of repeatable) {
      await queue.removeRepeatableByKey(j.key);
      console.log(`  removed repeatable key=${j.key}`);
    }
    for (const s of schedulers) {
      await queue.removeJobScheduler(s.id);
      console.log(`  removed scheduler id=${s.id}`);
    }
    console.log('Done. Re-run without --remove-all to confirm the queue is now empty.');
  }

  await queue.close();
  await connection.quit();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
