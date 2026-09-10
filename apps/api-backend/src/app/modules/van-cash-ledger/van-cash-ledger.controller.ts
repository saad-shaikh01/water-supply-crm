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
import { SetOpeningBalanceDto } from './dto/set-opening-balance.dto';
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
import { RequireAnyPermission, RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StorageService } from '../../common/storage/storage.service';
import type { AuthUser } from '@water-supply-crm/types';

const ALLOWED_ATTACHMENT_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];

/**
 * Van Cash Ledger — the "cash in" counterpart to the Expense Center.
 *   - opening-balance → van_cash_ledger:manage (VENDOR_ADMIN only by preset).
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
    private readonly storage: StorageService,
  ) {}

  // ── Static routes BEFORE parameterised /:id routes ─────────────────────────

  @Post('opening-balance')
  @RequirePermissions('van_cash_ledger:manage')
  setOpeningBalance(@CurrentUser() user: AuthUser, @Body() dto: SetOpeningBalanceDto) {
    return this.vanCashLedger.setOpeningBalance(user, dto);
  }

  @Get('timeline')
  @RequirePermissions('van_cash_ledger:view')
  getTimeline(@CurrentUser() user: AuthUser, @Query() query: VanCashLedgerTimelineQueryDto) {
    return this.vanCashLedger.getTimeline(user.vendorId, query);
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
