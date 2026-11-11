import { diffJson } from './json-diff';
import { describeCron, relativeTime } from './format';

const byPath = (d: ReturnType<typeof diffJson>) => Object.fromEntries(d.map((e) => [e.path, e]));

describe('diffJson', () => {
  it('detects add / remove / change on nested keys', () => {
    const d = byPath(diffJson({ a: 1, n: { x: 1, y: 2 }, gone: true }, { a: 2, n: { x: 1, z: 3 }, fresh: 'y' }));
    expect(d['a']).toMatchObject({ kind: 'changed', before: 1, after: 2 });
    expect(d['n.x'].kind).toBe('same');
    expect(d['n.y']).toMatchObject({ kind: 'removed', before: 2 });
    expect(d['n.z']).toMatchObject({ kind: 'added', after: 3 });
    expect(d['gone'].kind).toBe('removed');
    expect(d['fresh'].kind).toBe('added');
  });

  it('diffs arrays by index', () => {
    const d = byPath(diffJson({ t: [1, 2, 3] }, { t: [1, 5] }));
    expect(d['t[0]'].kind).toBe('same');
    expect(d['t[1]']).toMatchObject({ kind: 'changed', before: 2, after: 5 });
    expect(d['t[2]']).toMatchObject({ kind: 'removed', before: 3 });
  });

  it('null before (CREATE) marks everything added', () => {
    const d = diffJson(null, { name: 'A', meta: { k: 1 } });
    expect(d.every((e) => e.kind === 'added')).toBe(true);
    expect(d.map((e) => e.path).sort()).toEqual(['meta.k', 'name']);
  });

  it('null after (DELETE) marks everything removed', () => {
    const d = diffJson({ name: 'A' }, null);
    expect(d).toEqual([{ path: 'name', kind: 'removed', before: 'A', after: undefined }]);
  });

  it('identical objects produce only "same" entries', () => {
    const d = diffJson({ a: 1, b: { c: [1] } }, { a: 1, b: { c: [1] } });
    expect(d.length).toBeGreaterThan(0);
    expect(d.every((e) => e.kind === 'same')).toBe(true);
  });

  it('type change primitive <-> object is a single changed entry', () => {
    const d = diffJson({ v: 1 }, { v: { a: 1 } });
    expect(d).toEqual([{ path: 'v', kind: 'changed', before: 1, after: { a: 1 } }]);
  });

  it('handles 1k keys in under 50ms', () => {
    const a: Record<string, number> = {};
    const b: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) {
      a[`k${i}`] = i;
      b[`k${i}`] = i % 2 ? i : i + 1;
    }
    const t0 = performance.now();
    const d = diffJson(a, b);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(d.filter((e) => e.kind === 'changed')).toHaveLength(500);
  });

  it('both absent -> empty', () => {
    expect(diffJson(null, null)).toEqual([]);
  });
});

describe('format helpers', () => {
  it('relativeTime past/future', () => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    expect(relativeTime('2026-01-01T11:55:00Z', now)).toBe('5 min ago');
    expect(relativeTime('2026-01-01T15:00:00Z', now)).toBe('in 3 h');
    expect(relativeTime(null, now)).toBe('—');
  });
  it('describeCron', () => {
    expect(describeCron('0 5 * * *')).toBe('Daily at 05:00');
    expect(describeCron('*/15 * * * *')).toBe('Every 15 minutes');
    expect(describeCron('1 2 3 4 5')).toBe('1 2 3 4 5');
  });
});
