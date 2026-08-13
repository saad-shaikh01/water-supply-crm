import { computeMaintenanceStatus, DUE_KM_THRESHOLD, DUE_DAYS_THRESHOLD, UPCOMING_KM_THRESHOLD, UPCOMING_DAYS_THRESHOLD } from './fleet-maintenance.util';

describe('computeMaintenanceStatus', () => {
  const now = new Date('2026-08-15T00:00:00.000Z');
  const baselineDate = new Date('2026-01-01T00:00:00.000Z');

  it('is OK when far from both the km and day thresholds', () => {
    const result = computeMaintenanceStatus({
      intervalKm: 5000,
      intervalDays: 180,
      lastServiceOdometer: 10000,
      lastServiceDate: new Date('2026-08-01T00:00:00.000Z'),
      currentOdometer: 11000, // 4000 km remaining
      baselineDate,
      now,
    });
    expect(result.urgency).toBe('OK');
    expect(result.dueAtOdometer).toBe(15000);
    expect(result.kmRemaining).toBe(4000);
  });

  it('is OVERDUE once the odometer has passed the due point, even if the date is not yet due', () => {
    const result = computeMaintenanceStatus({
      intervalKm: 5000,
      intervalDays: 365,
      lastServiceOdometer: 10000,
      lastServiceDate: new Date('2026-08-01T00:00:00.000Z'),
      currentOdometer: 15200, // 200 km past due
      baselineDate,
      now,
    });
    expect(result.urgency).toBe('OVERDUE');
    expect(result.kmRemaining).toBe(-200);
  });

  it('is OVERDUE once the calendar date has passed, even if the odometer has barely moved', () => {
    const result = computeMaintenanceStatus({
      intervalKm: 50000,
      intervalDays: 30,
      lastServiceOdometer: 10000,
      lastServiceDate: new Date('2026-07-01T00:00:00.000Z'), // 45 days before `now`
      currentOdometer: 10100,
      baselineDate,
      now,
    });
    expect(result.urgency).toBe('OVERDUE');
    expect(result.daysRemaining).toBeLessThan(0);
  });

  it('"whichever comes first": a km-only rule ignores elapsed time', () => {
    const result = computeMaintenanceStatus({
      intervalKm: 5000,
      intervalDays: null,
      lastServiceOdometer: 10000,
      lastServiceDate: new Date('2020-01-01T00:00:00.000Z'), // 6+ years ago — irrelevant, no day interval
      currentOdometer: 11000,
      baselineDate,
      now,
    });
    expect(result.dueAtDate).toBeNull();
    expect(result.daysRemaining).toBeNull();
    expect(result.urgency).toBe('OK');
  });

  it('falls back to odometer 0 when never serviced (km leg only, isolated from the date leg)', () => {
    const result = computeMaintenanceStatus({
      intervalKm: 5000,
      intervalDays: null,
      lastServiceOdometer: null,
      lastServiceDate: null,
      currentOdometer: 4800,
      baselineDate,
      now,
    });
    expect(result.dueAtOdometer).toBe(5000);
    expect(result.kmRemaining).toBe(200);
    expect(result.urgency).toBe('DUE'); // 200 <= DUE_KM_THRESHOLD (300)
  });

  it('falls back to the baseline date when never serviced (date leg only, isolated from the km leg)', () => {
    // baselineDate is 2026-01-01; 180 days later is ~2026-06-30, well before `now` (2026-08-15).
    const result = computeMaintenanceStatus({
      intervalKm: null,
      intervalDays: 180,
      lastServiceOdometer: null,
      lastServiceDate: null,
      currentOdometer: 0,
      baselineDate,
      now,
    });
    expect(result.urgency).toBe('OVERDUE');
  });

  it('crosses OK -> UPCOMING -> DUE -> OVERDUE exactly at the documented thresholds', () => {
    const dueAt = 20000;
    const makeResult = (currentOdometer: number) =>
      computeMaintenanceStatus({
        intervalKm: 5000,
        intervalDays: null,
        lastServiceOdometer: dueAt - 5000,
        lastServiceDate: null,
        currentOdometer,
        baselineDate,
        now,
      });

    expect(makeResult(dueAt - UPCOMING_KM_THRESHOLD - 1).urgency).toBe('OK');
    expect(makeResult(dueAt - UPCOMING_KM_THRESHOLD).urgency).toBe('UPCOMING');
    expect(makeResult(dueAt - DUE_KM_THRESHOLD).urgency).toBe('DUE');
    expect(makeResult(dueAt).urgency).toBe('OVERDUE');
  });

  it('crosses OK -> UPCOMING -> DUE -> OVERDUE exactly at the documented day thresholds', () => {
    // Fixed due date (lastServiceDate + intervalDays); vary `now` to move
    // daysRemaining across each threshold instead of varying the interval.
    const dueDate = new Date('2026-09-10T00:00:00.000Z');
    const makeResult = (daysBeforeDue: number) =>
      computeMaintenanceStatus({
        intervalKm: null,
        intervalDays: 180,
        lastServiceOdometer: null,
        lastServiceDate: new Date(dueDate.getTime() - 180 * 24 * 60 * 60 * 1000),
        currentOdometer: 0,
        baselineDate,
        now: new Date(dueDate.getTime() - daysBeforeDue * 24 * 60 * 60 * 1000),
      });

    expect(makeResult(UPCOMING_DAYS_THRESHOLD + 1).urgency).toBe('OK');
    expect(makeResult(UPCOMING_DAYS_THRESHOLD).urgency).toBe('UPCOMING');
    expect(makeResult(DUE_DAYS_THRESHOLD).urgency).toBe('DUE');
    expect(makeResult(0).urgency).toBe('OVERDUE');
  });
});
