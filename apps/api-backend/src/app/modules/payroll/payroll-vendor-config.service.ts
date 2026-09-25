import { Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import type { AuthUser } from '@water-supply-crm/types';
import { AuditService } from '../audit/audit.service';
import { UpdatePayrollVendorConfigDto } from './dto/update-payroll-vendor-config.dto';

/**
 * Vendor-wide Payroll settings — the attendance/wage period's `cutoffDay`,
 * and the optional, separately-anchored cash-deduction window
 * (`cashCutoffDay`/`cashWindowCategories`, owner-requested 2026-09-25 — see
 * the schema comment on `PayrollVendorConfig`). A missing row means every
 * default (`cutoffDay=1` i.e. plain calendar months, cash window disabled)
 * — mirrors `CollectionPolicyService`'s "missing row = default" convention,
 * simplified: no caching, since this is read directly by
 * `PayrollPeriodService`/`PayrollEntryService` at most a few times per
 * payroll run, not on a hot request path.
 */
@Injectable()
export class PayrollVendorConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getConfig(vendorId: string) {
    const row = await this.prisma.payrollVendorConfig.findUnique({ where: { vendorId } });
    return {
      cutoffDay: row?.cutoffDay ?? 1,
      cashCutoffDay: row?.cashCutoffDay ?? null,
      cashWindowCategories: row?.cashWindowCategories ?? [],
      autoLockEnabled: row?.autoLockEnabled ?? false,
    };
  }

  async updateConfig(user: AuthUser, dto: UpdatePayrollVendorConfigDto) {
    const data = {
      cutoffDay: dto.cutoffDay,
      cashCutoffDay: dto.cashCutoffDay,
      cashWindowCategories: dto.cashWindowCategories,
      ...(dto.autoLockEnabled !== undefined ? { autoLockEnabled: dto.autoLockEnabled } : {}),
      updatedById: user.userId,
    };

    const row = await this.prisma.payrollVendorConfig.upsert({
      where: { vendorId: user.vendorId },
      create: { vendorId: user.vendorId, autoLockEnabled: false, ...data },
      update: data,
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'UPDATE_PAYROLL_VENDOR_CONFIG',
      entity: 'PayrollVendorConfig',
      entityId: row.id,
      changes: { after: dto },
    });

    return {
      cutoffDay: row.cutoffDay,
      cashCutoffDay: row.cashCutoffDay,
      cashWindowCategories: row.cashWindowCategories,
      autoLockEnabled: row.autoLockEnabled,
    };
  }
}
