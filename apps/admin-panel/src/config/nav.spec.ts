import fs from 'fs';
import path from 'path';
import { NAV_ITEMS, isNavActive, sortedNavItems } from './nav';

describe('nav registry', () => {
  it('has unique ids, hrefs and orders; hrefs start with /', () => {
    expect(new Set(NAV_ITEMS.map((n) => n.id)).size).toBe(NAV_ITEMS.length);
    expect(new Set(NAV_ITEMS.map((n) => n.href)).size).toBe(NAV_ITEMS.length);
    expect(new Set(NAV_ITEMS.map((n) => n.order)).size).toBe(NAV_ITEMS.length);
    NAV_ITEMS.forEach((n) => expect(n.href.startsWith('/')).toBe(true));
  });

  it('every non-root href has a folder under app/(dashboard) (no 404 links)', () => {
    const base = path.join(__dirname, '..', 'app', '(dashboard)');
    NAV_ITEMS.filter((n) => n.href !== '/').forEach((n) => {
      expect(fs.existsSync(path.join(base, n.href.slice(1), 'page.tsx'))).toBe(true);
    });
    expect(fs.existsSync(path.join(base, 'page.tsx'))).toBe(true);
  });

  it('uses the reserved orders for overview, vendors, settings', () => {
    const byId = Object.fromEntries(NAV_ITEMS.map((n) => [n.id, n.order]));
    expect(byId).toMatchObject({ overview: 10, vendors: 20, settings: 100 });
    expect(sortedNavItems().map((n) => n.id)).toEqual(['overview', 'vendors', 'settings']);
  });

  it('root is exact-match, others prefix-match', () => {
    const [overview, vendors] = sortedNavItems();
    expect(isNavActive(overview, '/')).toBe(true);
    expect(isNavActive(overview, '/vendors')).toBe(false);
    expect(isNavActive(vendors, '/vendors/123')).toBe(true);
    expect(isNavActive(vendors, '/vendorsx')).toBe(false);
  });
});
