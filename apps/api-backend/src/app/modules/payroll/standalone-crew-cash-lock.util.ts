/**
 * Shared rule: may a Standalone Crew Cash entry still be EDITED in place?
 *
 * Each entry has a StaffLedgerEntry "payroll twin". While the twin has not been
 * rolled into a locked payroll period (`payrollEntryId === null`) the edit can
 * void it and post a fresh one atomically. Once it is rolled in, the payroll
 * figures are frozen history — the edit is blocked and the user is told to
 * void (which reverses in the CURRENT payroll period) and re-record.
 *
 * Used by BOTH StandaloneCrewCashService (enforcement) and VanCashLedgerService
 * (the per-row `canEdit` / `editBlockedReason` the timeline shows), so the two
 * can never disagree.
 */
export const STANDALONE_CREW_CASH_LOCKED_REASON =
  'This crew-cash entry has already been rolled into a locked payroll period, so it can no longer be edited. ' +
  'Void it and record a new one instead — the void reverses it in the current payroll period.';

export function isStandaloneCrewCashTwinLocked(
  twin: { payrollEntryId: string | null } | null | undefined,
): boolean {
  return !!twin && twin.payrollEntryId !== null;
}
