import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { AuthUser } from '@water-supply-crm/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PreviewPayrollSlipsDto, SendPayrollSlipsDto } from './dto/send-payroll-slips.dto';
import { PayrollSlipService } from './payroll-slip.service';

/**
 * Salary slips on WhatsApp (Monthly Payroll). Sending messages staff phones is `payroll:slip_send`
 * (VENDOR_ADMIN-only by default); the per-entry "slip sent" chips read through `payroll:view_all`,
 * the same gate as the table they decorate. Static `slips/...` paths — no `/:id` clash.
 */
@Controller('payroll')
export class PayrollSlipController {
  constructor(private readonly slips: PayrollSlipService) {}

  /** GET /payroll/periods/:periodId/slips/status — last slip state per entry + active dispatch progress. */
  @Get('periods/:periodId/slips/status')
  @RequirePermissions('payroll:view_all')
  status(@CurrentUser() user: AuthUser, @Param('periodId') periodId: string) {
    return this.slips.status(user, periodId);
  }

  /** POST /payroll/periods/:periodId/slips/preview — who would get a slip, who is skipped and why. */
  @Post('periods/:periodId/slips/preview')
  @RequirePermissions('payroll:slip_send')
  preview(@CurrentUser() user: AuthUser, @Param('periodId') periodId: string, @Body() dto: PreviewPayrollSlipsDto) {
    return this.slips.preview(user, periodId, dto);
  }

  /** POST /payroll/periods/:periodId/slips/send — queue the send (202-style: returns immediately). */
  @Post('periods/:periodId/slips/send')
  @RequirePermissions('payroll:slip_send')
  send(@CurrentUser() user: AuthUser, @Param('periodId') periodId: string, @Body() dto: SendPayrollSlipsDto) {
    return this.slips.send(user, periodId, dto);
  }

  /** GET /payroll/slips/dispatches/:id — per-employee result of one send. */
  @Get('slips/dispatches/:id')
  @RequirePermissions('payroll:slip_send')
  dispatchDetail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.slips.dispatchDetail(user, id);
  }
}
