import { Module } from '@nestjs/common';
import { SalaryStructureService } from './salary-structure.service';
import { SalaryStructureController } from './salary-structure.controller';
import { StaffLedgerService } from './staff-ledger.service';
import { StaffLedgerController } from './staff-ledger.controller';
import { PayrollApprovalGateService } from './payroll-approval-gate.service';
import { PayrollPeriodService } from './payroll-period.service';
import { PayrollPeriodController } from './payroll-period.controller';
import { PayrollEntryService } from './payroll-entry.service';
import { PayrollEntryController } from './payroll-entry.controller';
import { SettlementService } from './settlement.service';
import { SettlementController } from './settlement.controller';

/**
 * Staff Payroll & Financial Management — Phase 1b.
 * SalaryStructure + StaffLedgerEntry CRUD, the reusable approval gate, the
 * PayrollPeriod lifecycle (open/lock/unlock), and the PayrollEntry
 * calculation engine (generate/approve/breakdown). Fine-grained payroll:*
 * RBAC (Amendment R3, docs/rbac-permission-catalog.md §27) replaces the
 * interim `@RequireRoles` gate originally used on every mutation — see
 * StaffLedgerController's doc comment. `PermissionService` (self-view
 * scoping, void's creator exception) comes from the `@Global` AuthzModule,
 * so it needs no explicit import here.
 *
 * A `PayrollApprovalRule` CRUD surface (vendor-configurable approval
 * thresholds) and its `payroll:approval_rules_manage` permission were
 * drafted alongside the RBAC work above and rejected on review — no such
 * management endpoint is specified anywhere in the approved planning doc.
 * `PayrollApprovalRule` rows are still read by `PayrollApprovalGateService`
 * (the schema/read path is real and unaffected); a config-CRUD endpoint for
 * managing those rows, if wanted, is a scoped future addition, not this one.
 *
 * Settlement and cron-based period auto-rollover are later, separately
 * scoped pieces of work — see the schema module note above these models in
 * libs/shared/database/prisma/schema.prisma.
 */
@Module({
  controllers: [
    SalaryStructureController,
    StaffLedgerController,
    PayrollPeriodController,
    PayrollEntryController,
    SettlementController,
  ],
  providers: [
    SalaryStructureService,
    StaffLedgerService,
    PayrollApprovalGateService,
    PayrollPeriodService,
    PayrollEntryService,
    SettlementService,
  ],
  exports: [
    SalaryStructureService,
    StaffLedgerService,
    PayrollApprovalGateService,
    PayrollPeriodService,
    PayrollEntryService,
    SettlementService,
  ],
})
export class PayrollModule {}
