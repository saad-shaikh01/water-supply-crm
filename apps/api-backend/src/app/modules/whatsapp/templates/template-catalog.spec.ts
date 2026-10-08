import { CloudTemplateNames } from './cloud-template-names';
import { TEMPLATE_CATALOG, renderTemplateBody, templateNameFor } from './template-catalog';

describe('WhatsApp template catalogue', () => {
  it('covers every template the code sends (except the one whose approved body is not recorded)', () => {
    const catalogued = new Set(TEMPLATE_CATALOG.map((t) => t.name));
    const missing = Object.values(CloudTemplateNames).filter((n) => !catalogued.has(n));
    expect(missing).toEqual(['payment_recorded_corrected']);
    expect(catalogued.size).toBe(TEMPLATE_CATALOG.length); // no duplicates
  });

  it.each(TEMPLATE_CATALOG.map((t) => [t.name, t] as const))('%s: variables, samples and body agree (Meta rejects a mismatch)', (_n, t) => {
    const used = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    const distinct = [...new Set(used)].sort((a, b) => a - b);
    expect(distinct).toEqual(Array.from({ length: t.variables.length }, (_, i) => i + 1)); // sequential 1..n
    expect(t.sample).toHaveLength(t.variables.length);
    expect(t.body).not.toMatch(/\n\s*\n\s*\n/); // Meta rejects 3+ consecutive newlines
    expect(t.body.trim()).toBe(t.body); // no leading/trailing whitespace
  });

  it('no template hardcodes any company — the brand is a placeholder', () => {
    for (const t of TEMPLATE_CATALOG) expect(t.body).not.toMatch(/Blue Ice|Dasani/i);
  });

  it('renders the vendor’s own brand into the body', () => {
    const t = TEMPLATE_CATALOG.find((x) => x.name === 'balance_reminder')!;
    const body = renderTemplateBody(t, 'LOREM WATER');
    expect(body).toContain('Thank you for choosing LOREM WATER.');
    expect(body).not.toContain('{{brand}}');
    expect(body).toContain('{{1}}'); // positional variables stay for Meta
  });

  it('Blue Ice bodies are reproduced exactly (only the brand placeholder differs)', () => {
    const t = TEMPLATE_CATALOG.find((x) => x.name === 'delivery_receipt')!;
    expect(renderTemplateBody(t, 'Blue Ice')).toBe(`Assalamu Alaikum, {{1}},

Your Delivery Receipt is attached for your records.

Customer Code: {{2}}
Delivery Date: {{3}}
Delivery Status: Successfully Delivered

Thank you for choosing Blue Ice.

We appreciate your continued trust and business.

Blue Ice`);
  });

  it('core customer flows are marked required for go-live; internal ones are not customer-facing', () => {
    const required = TEMPLATE_CATALOG.filter((t) => t.required).map((t) => t.name);
    expect(required).toEqual(expect.arrayContaining(['delivery_receipt', 'monthly_statement', 'payment_received', 'balance_reminder', 'order_approved', 'ticket_replied', 'payment_recorded']));
    expect(TEMPLATE_CATALOG.filter((t) => t.internal).map((t) => t.name).sort()).toEqual(['fleet_document_expiry', 'fleet_maintenance_due', 'salary_slip']);
    expect(TEMPLATE_CATALOG.filter((t) => t.internal).some((t) => t.required)).toBe(false);
  });

  it('template naming: plain for the first brand, <name>_<suffix> for a brand sharing the WABA', () => {
    expect(templateNameFor('delivery_receipt')).toBe('delivery_receipt');
    expect(templateNameFor('delivery_receipt', null)).toBe('delivery_receipt');
    expect(templateNameFor('delivery_receipt', 'lorem')).toBe('delivery_receipt_lorem');
  });
});
