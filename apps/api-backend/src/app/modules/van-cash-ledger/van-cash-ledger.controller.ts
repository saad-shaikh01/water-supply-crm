import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { Throttle } from '@nestjs/throttler';
import { VanCashLedgerService } from './van-cash-ledger.service';
import { AddCashInDto } from './dto/add-cash-in.dto';
import { EditManualCashInDto } from './dto/edit-manual-cash-in.dto';
import { VoidManualCashInDto } from './dto/void-manual-cash-in.dto';
import { ApproveHandoverDto } from './dto/approve-handover.dto';
import { CreateRemittanceDto } from './dto/create-remittance.dto';
import { ApproveRemittanceDto } from './dto/approve-remittance.dto';
import { VoidRemittanceDto } from './dto/void-remittance.dto';
import { CorrectRemittanceDto } from './dto/correct-remittance.dto';
import {
  VanCashLedgerPendingQueryDto,
  VanCashLedgerStatsQueryDto,
  VanCashLedgerTimelineQueryDto,
} from './dto/van-cash-ledger-query.dto';
import { CashLedgerDailySummaryQueryDto } from './dto/cash-ledger-daily-summary-query.dto';
import { ClosePeriodDto } from './dto/close-period.dto';
import { ReopenPeriodDto } from './dto/reopen-period.dto';
import { CashLedgerPeriodService } from './cash-ledger-period.service';
import { isPeriodLabel } from './cash-ledger-period.util';
import { RequireAnyPermission, RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StorageService } from '../../common/storage/storage.service';
import type { AuthUser } from '@water-supply-crm/types';

const ALLOWED_ATTACHMENT_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];

/** 400 unless the `:label` route param is a well-formed period label (YYYY-MM). */
function assertPeriodLabel(label: string): string {
  if (!isPeriodLabel(label)) throw new BadRequestException('Period label must look like YYYY-MM.');
  return label;
}

/**
 * Van Cash Ledger — the "cash in" counterpart to the Expense Center.
 *   - manual-cash-in (create / PATCH edit / PATCH :id/void) → van_cash_ledger:manage (VENDOR_ADMIN only by preset).
 *   - entries/:sourceType/:sourceRecordId/history → van_cash_ledger:view.
 *   - timeline/stats/pending-handovers/pending-remittances → van_cash_ledger:view.
 *   - cash-in/:id/approve → van_cash_ledger:approve.
 *   - remittance (office → owner/CEO/bank), owner-requested 2026-09-10:
 *       POST remittance, POST remittance/attachment → van_cash_ledger:remit.
 *       PATCH remittance/:id/approve → van_cash_ledger:remit_approve.
 *       PATCH remittance/:id/{correct,void} → any of remit_approve / remit_void /
 *        remit; the service then allows a plain `remit` holder through ONLY for
 *        their own still-pending row, requires remit_approve for anyone else or
 *        an approved chain, and requires remit_void to void an approved row.
 */
@Controller('van-cash-ledger')
export class VanCashLedgerController {
  constructor(
    private readonly vanCashLedger: VanCashLedgerService,
    private readonly periods: CashLedgerPeriodService,
    private readonly storage: StorageService,
  ) {}

  // ── Static routes BEFORE parameterised /:id routes ─────────────────────────

  @Post('manual-cash-in')
  @RequirePermissions('van_cash_ledger:manage')
  addManualCashIn(@CurrentUser() user: AuthUser, @Body() dto: AddCashInDto) {
    return this.vanCashLedger.addManualCashIn(user, dto);
  }

  /** Edit an ACTIVE manual cash-in in place (the normal correction). Mandatory `reason` + optimistic `version`. */
  @Patch('manual-cash-in/:id')
  @RequirePermissions('van_cash_ledger:manage')
  editManualCashIn(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: EditManualCashInDto) {
    return this.vanCashLedger.editManualCashIn(user, id, dto);
  }

  /** Void an ACTIVE manual cash-in (secondary action — status flip, never a DELETE). */
  @Patch('manual-cash-in/:id/void')
  @RequirePermissions('van_cash_ledger:manage')
  voidManualCashIn(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: VoidManualCashInDto) {
    return this.vanCashLedger.voidManualCashIn(user, id, dto);
  }

  /** Newest-first change history of one ledger entry (reuses the generic AuditLog). */
  @Get('entries/:sourceType/:sourceRecordId/history')
  @RequirePermissions('van_cash_ledger:view')
  getEntryHistory(
    @CurrentUser() user: AuthUser,
    @Param('sourceType') sourceType: string,
    @Param('sourceRecordId') sourceRecordId: string,
  ) {
    return this.vanCashLedger.getEntryHistory(user.vendorId, sourceType, sourceRecordId);
  }

  @Get('timeline')
  @RequirePermissions('van_cash_ledger:view')
  getTimeline(@CurrentUser() user: AuthUser, @Query() query: VanCashLedgerTimelineQueryDto) {
    return this.vanCashLedger.getTimeline(user.vendorId, query, user);
  }

  /** Reconciliation header (statement + memo + trend) for a van / the whole office over a window. */
  @Get('summary')
  @RequirePermissions('van_cash_ledger:view')
  getSummary(@CurrentUser() user: AuthUser, @Query() query: VanCashLedgerStatsQueryDto) {
    return this.vanCashLedger.getSummary(user.vendorId, query);
  }

  /** Table view: one reconciliation row per day / week / month (statements are always the true date + van scope). */
  @Get('daily-summary')
  @RequirePermissions('van_cash_ledger:view')
  getDailySummary(@CurrentUser() user: AuthUser, @Query() query: CashLedgerDailySummaryQueryDto) {
    return this.vanCashLedger.getDailySummary(user.vendorId, query);
  }

  // ── Accounting periods (P4) — static routes, before any parameterised ones ──

  /** Month-by-month period list (newest first) with status, as-closed vs live balance and the caller's permissions. */
  @Get('periods')
  @RequirePermissions('van_cash_ledger:view')
  listPeriods(@CurrentUser() user: AuthUser) {
    return this.periods.list(user);
  }

  /** Blockers / warnings / statement preview for closing a period. */
  @Get('periods/:label/close-check')
  @RequirePermissions('van_cash_ledger:close_period')
  getPeriodCloseCheck(@CurrentUser() user: AuthUser, @Param('label') label: string) {
    return this.periods.closeCheck(user.vendorId, assertPeriodLabel(label));
  }

  @Post('periods/:label/close')
  @RequirePermissions('van_cash_ledger:close_period')
  closePeriod(@CurrentUser() user: AuthUser, @Param('label') label: string, @Body() dto: ClosePeriodDto) {
    return this.periods.close(user, assertPeriodLabel(label), dto);
  }

  @Post('periods/:label/reopen')
  @RequirePermissions('van_cash_ledger:close_period')
  reopenPeriod(@CurrentUser() user: AuthUser, @Param('label') label: string, @Body() dto: ReopenPeriodDto) {
    return this.periods.reopen(user, assertPeriodLabel(label), dto);
  }

  /** How one Daily Sheet's handover was derived (collected − expenses − crew cash vs expected / approved). */
  @Get('sheets/:sheetId/cash-breakdown')
  @RequirePermissions('van_cash_ledger:view')
  getSheetCashBreakdown(@CurrentUser() user: AuthUser, @Param('sheetId') sheetId: string) {
    return this.vanCashLedger.getSheetCashBreakdown(user.vendorId, sheetId);
  }

  @Get('stats')
  @RequirePermissions('van_cash_ledger:view')
  getStats(@CurrentUser() user: AuthUser, @Query() query: VanCashLedgerStatsQueryDto) {
    return this.vanCashLedger.getStats(user.vendorId, query);
  }

  @Get('pending-handovers')
  @RequirePermissions('van_cash_ledger:view')
  getPendingHandovers(@CurrentUser() user: AuthUser, @Query() query: VanCashLedgerPendingQueryDto) {
    return this.vanCashLedger.getPendingHandovers(user.vendorId, query.vanId);
  }

  @Get('pending-remittances')
  @RequirePermissions('van_cash_ledger:view')
  getPendingRemittances(@CurrentUser() user: AuthUser) {
    return this.vanCashLedger.getPendingRemittances(user.vendorId);
  }

  @Patch('cash-in/:id/approve')
  @RequirePermissions('van_cash_ledger:approve')
  approveHandover(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ApproveHandoverDto) {
    return this.vanCashLedger.approveHandover(user, id, dto);
  }

  // ── Office Cash Remittance (office → owner / CEO / bank) ────────────────────

  /**
   * POST /van-cash-ledger/remittance/attachment
   * Upload a single deposit-slip / signed-receipt image or PDF to Wasabi.
   * Returns { key } — pass it as CreateRemittanceDto.attachmentKey.
   */
  @Post('remittance/attachment')
  @RequirePermissions('van_cash_ledger:remit')
  @Throttle({ short: { ttl: 2000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_ATTACHMENT_EXTS.includes(extname(file.originalname).toLowerCase())) {
          cb(null, true);
        } else {
          cb(new Error('Only JPG, PNG, WEBP, or PDF files are allowed'), false);
        }
      },
    }),
  )
  async uploadRemittanceAttachment(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');
    const { key } = await this.storage.upload(
      'office-cash-remittance',
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    return { key };
  }

  @Post('remittance')
  @RequirePermissions('van_cash_ledger:remit')
  createRemittance(@CurrentUser() user: AuthUser, @Body() dto: CreateRemittanceDto) {
    return this.vanCashLedger.createRemittance(user, dto);
  }

  @Get('remittance/:id/attachment')
  @RequirePermissions('van_cash_ledger:view')
  async getRemittanceAttachment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const key = await this.vanCashLedger.getRemittanceAttachmentKey(user.vendorId, id);
    return { signedUrl: await this.storage.getSignedUrl(key) };
  }

  @Patch('remittance/:id/approve')
  @RequirePermissions('van_cash_ledger:remit_approve')
  approveRemittance(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ApproveRemittanceDto,
  ) {
    return this.vanCashLedger.approveRemittance(user, id, dto);
  }

  // Void / correct: the route is reachable by an approver, a remit_void holder,
  // OR a plain `remit` holder — the last so a submitter can retract/fix their
  // OWN still-pending remittance. The service enforces creator-only in that
  // case, and requires approver authority for anyone else / an approved row.
  @Patch('remittance/:id/correct')
  @RequireAnyPermission(
    'van_cash_ledger:remit_approve',
    'van_cash_ledger:remit_void',
    'van_cash_ledger:remit',
  )
  correctRemittance(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CorrectRemittanceDto,
  ) {
    return this.vanCashLedger.correctRemittance(user, id, dto);
  }

  @Patch('remittance/:id/void')
  @RequireAnyPermission(
    'van_cash_ledger:remit_approve',
    'van_cash_ledger:remit_void',
    'van_cash_ledger:remit',
  )
  voidRemittance(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: VoidRemittanceDto,
  ) {
    return this.vanCashLedger.voidRemittance(user, id, dto);
  }
}
