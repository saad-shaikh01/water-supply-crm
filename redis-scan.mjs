import Redis from 'ioredis';
const pat = process.argv[2] || '*';
const r = new Redis(process.env['REDIS_URL'] || 'redis://localhost:6379');
console.log('connected to', process.env['REDIS_URL'] || 'redis://localhost:6379');
console.log('dbsize:', await r.dbsize());
const out = [];
let cursor = '0';
do {
  const [next, keys] = await r.scan(cursor, 'MATCH', pat, 'COUNT', 200);
  cursor = next; out.push(...keys);
} while (cursor !== '0' && out.length < 100);
console.log(`keys matching ${pat} (first ${Math.min(out.length,50)}):`);
out.slice(0, 50).forEach(k => console.log('  ' + k));
await r.quit();
