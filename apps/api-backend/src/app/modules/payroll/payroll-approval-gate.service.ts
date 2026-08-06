import { Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';

/**
 * Data-driven approval gate (PayrollApprovalRule) — reusable across any
 * payroll-adjacent flow keyed by (vendorId, categoryKey), not just
 * StaffLedgerEntry. `categoryKey` is a free-form string the rule table does
 * not interpret (today's StaffLedgerCategory values; a later module — e.g.
 * Crew Cash — can reuse this with its own category keys without a schema or
 * service change, per PayrollApprovalRule's schema module note).
 */
@Injectable()
export class PayrollApprovalGateService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * True when the (vendorId, categoryKey) rule requires approval AND either
   * has no threshold (approval required regardless of amount) or the
   * magnitude of `amount` meets/exceeds the threshold.
   *
   * `amount` may be signed (StaffLedgerEntry.amount is signed — positive
   * credit, negative debit); the threshold is compared against magnitude
   * since a configured threshold like "requires approval above ₨5,000" is
   * meant to gate large movements of money in either direction, not just
   * large credits.
   */
  async requiresApproval(vendorId: string, categoryKey: string, amount: number): Promise<boolean> {
    const rule = await this.prisma.payrollApprovalRule.findUnique({
      where: { vendorId_categoryKey: { vendorId, categoryKey } },
    });

    if (!rule || !rule.requiresApproval) return false;
    if (rule.thresholdAmount == null) return true;

    return Math.abs(amount) >= rule.thresholdAmount;
  }
}
