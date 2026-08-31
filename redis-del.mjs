/**
 * Tiny helper: delete one or more exact Redis keys via the app's REDIS_URL.
 * Use when `redis-cli` isn't installed on the box.
 *
 * Run:  node redis-del.mjs "key1" "key2" ...
 */
import Redis from 'ioredis';

const keys = process.argv.slice(2);
if (keys.length === 0) {
  console.error('usage: node redis-del.mjs "<key>" ["<key>" ...]');
  process.exit(1);
}

const redis = new Redis(process.env['REDIS_URL'] || 'redis://localhost:6379');

const n = await redis.del(...keys);
console.log(`deleted ${n} key(s):`);
for (const k of keys) console.log('  ' + k);

await redis.quit();
