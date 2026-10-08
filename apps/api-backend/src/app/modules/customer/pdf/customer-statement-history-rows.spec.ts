import { CustomerStatementPdfService } from './customer-statement-pdf.service';

/**
 * Imported history (Data Import, TransactionType.HISTORICAL): charge rows (they carry bottle counts) render in the
 * Delivery History table; payment rows (no bottle counts) stay in "Other Transactions" labelled "History". The
 * running balance is amount-based for both, so it matches the customer's ledger.
 */
describe('statement rows for imported history', () => {
  const svc = new CustomerStatementPdfService();
  const t = (over: Record<string, unknown>) => ({ id: 'abcdef123456', type: 'HISTORICAL', createdAt: new Date('2025-03-01T07:00:00Z'), amount: 0, filledDropped: null, emptyReceived: null, filledReceived: null, description: null, dailySheetItem: null, dailySheetItemId: null, ...over });

  it('puts history charge rows in the delivery table and history payments in the other table', () => {
    const { deliveryRows, otherRows } = svc.buildRows(
      [
        t({ id: 'c00001', amount: 400, filledDropped: 2, emptyReceived: 1, description: 'Delivered 2, Received 1' }),
        t({ id: 'p00001', amount: -150, description: 'Payment received', createdAt: new Date('2025-03-01T07:00:01Z') }),
      ],
      1000,
    );
    expect(deliveryRows).toHaveLength(1);
    expect(deliveryRows[0]).toMatchObject({ btlDelivered: 2, emptyPickup: 1, amountDue: 400, runningBalance: 1400, bottleBalance: null, repriceEligible: false });
    expect(otherRows).toEqual([{ date: expect.any(Date), type: 'History', description: 'Payment received', amount: -150, runningBalance: 1250 }]);
  });

  it('a history charge with a zero bottle count (money only) is still a delivery-table row; an ADJUSTMENT never is', () => {
    const { deliveryRows, otherRows } = svc.buildRows(
      [t({ id: 'c00002', amount: 90, filledDropped: 0, emptyReceived: 0, description: 'Charge' }), t({ id: 'a00001', type: 'ADJUSTMENT', amount: -10, description: 'Account adjustment' })],
      0,
    );
    expect(deliveryRows.map((r) => r.amountDue)).toEqual([90]);
    expect(otherRows.map((r) => r.type)).toEqual(['Adjustment']);
  });

  it('real DELIVERY rows behave exactly as before', () => {
    const { deliveryRows } = svc.buildRows([t({ id: 'd00001', type: 'DELIVERY', amount: 300, filledDropped: 2, emptyReceived: 2 })], 0);
    expect(deliveryRows).toHaveLength(1);
    expect(deliveryRows[0].runningBalance).toBe(300);
  });
});
