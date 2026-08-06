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
import { CrewCashDistributionService } from './crew-cash-distribution.service';
import { CrewCashDistributionController } from './crew-cash-distribution.controller';

/**
 * Staff Payroll & Financial Management — Phase 1b.
 * SalaryStructure + StaffLedgerEntry CRUD, the reusable approval gate, the
 * PayrollPeriod lifecycle (open/lock/unlock), the PayrollEntry calculation
 * engine (generate/approve/breakdown), and Settlement (partial payment,
 * auto-settle on cumulative match, explicit markSettled for the
 * finalPayable<=0 case). Fine-grained payroll:* RBAC (Amendment R3/R4,
 * docs/rbac-permission-catalog.md §27) replaces the interim `@RequireRoles`
 * gate originally used on every mutation — see StaffLedgerController's doc
 * comment. `PermissionService` (self-view scoping, void's creator
 * exception) comes from the `@Global` AuthzModule, so it needs no explicit
 * import here.
 *
 * A `PayrollApprovalRule` CRUD surface (vendor-configurable approval
 * thresholds) and its `payroll:approval_rules_manage` permission were
 * drafted alongside the RBAC work above and rejected on review — no such
 * management endpoint is specified anywhere in the approved planning doc.
 * `PayrollApprovalRule` rows are still read by `PayrollApprovalGateService`
 * (the schema/read path is real and unaffected); a config-CRUD endpoint for
 * managing those rows, if wanted, is a scoped future addition, not this one.
 *
 * Cron-based period auto-rollover is a later, separately scoped piece of
 * work — see the schema module note above these models in
 * libs/shared/database/prisma/schema.prisma.
 *
 * Crew Cash Distribution (Phase 3-2) is an extension of Payroll, not a new
 * module — docs/features/crew-operational-cash-distribution.md. Sync into
 * the Payroll Ledger at DailySheet.closeSheet() and post-close
 * reversal/correction are separate, later dispatches; this phase only
 * covers pre-close create/edit/delete/approve.
 */
@Module({
  controllers: [
    SalaryStructureController,
    StaffLedgerController,
    PayrollPeriodController,
    PayrollEntryController,
    SettlementController,
    CrewCashDistributionController,
  ],
  providers: [
    SalaryStructureService,
    StaffLedgerService,
    PayrollApprovalGateService,
    PayrollPeriodService,
    PayrollEntryService,
    SettlementService,
    CrewCashDistributionService,
  ],
  exports: [
    SalaryStructureService,
    StaffLedgerService,
    PayrollApprovalGateService,
    PayrollPeriodService,
    PayrollEntryService,
    SettlementService,
    CrewCashDistributionService,
  ],
})
export class PayrollModule {}
