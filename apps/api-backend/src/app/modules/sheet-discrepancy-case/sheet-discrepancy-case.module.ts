import { Module } from '@nestjs/common';
import { SheetDiscrepancyCaseService } from './sheet-discrepancy-case.service';
import { SheetDiscrepancyCaseController } from './sheet-discrepancy-case.controller';
import { PayrollModule } from '../payroll/payroll.module';

/**
 * Sheet Discrepancy Case — reconciliation-gap resolution flow (charge to
 * driver / company loss / waived) for bottle/empty/cash discrepancies found
 * at DailySheet close time. Imports PayrollModule for StaffLedgerService
 * (charge-to-driver primitive) — same import daily-sheet.module.ts already
 * has for CrewCashDistributionService. Composed INTO DailySheetModule (see
 * daily-sheet.module.ts) since case creation is called from inside
 * DailySheetService.closeSheet(), unlike the standalone DamageCaseModule.
 */
@Module({
  imports: [PayrollModule],
  controllers: [SheetDiscrepancyCaseController],
  providers: [SheetDiscrepancyCaseService],
  exports: [SheetDiscrepancyCaseService],
})
export class SheetDiscrepancyCaseModule {}
