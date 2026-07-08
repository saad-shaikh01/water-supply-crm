import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Query,
  Res,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { DailySheetService } from './daily-sheet.service';
import { DailySheetPdfService } from './pdf/daily-sheet-pdf.service';
import { BulkImportService } from './bulk-import.service';
import { StorageService } from '../../common/storage/storage.service';
import { BulkImportConfirmDto } from './dto/bulk-import-confirm.dto';
import { GlobalImportConfirmDto } from './dto/global-import-confirm.dto';
import { GenerateSheetsDto } from './dto/generate-sheets.dto';
import { SubmitDeliveryDto } from './dto/submit-delivery.dto';
import { LoadOutDto } from './dto/load-out.dto';
import { CheckInDto } from './dto/check-in.dto';
import { SwapDriverDto } from './dto/swap-driver.dto';
import { CreateLoadDto } from './dto/create-load.dto';
import { CheckinLoadDto } from './dto/checkin-load.dto';
import { DailySheetQueryDto } from './dto/daily-sheet-query.dto';
import { InsertOrderItemDto } from './dto/insert-order-item.dto';
import { AddAdhocItemDto } from './dto/add-adhoc-item.dto';
import { AddCorrectionItemDto } from './dto/add-correction-item.dto';
import { UnlockEditDto } from './dto/unlock-edit.dto';
import { CreateDeliveryNoteDto } from './dto/create-delivery-note.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

const ALLOWED_AUDIO_MIMES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-m4a'];
const ALLOWED_EXCEL_MIMES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];
const ALLOWED_DELIVERY_PHOTO_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

@Controller('daily-sheets')
export class DailySheetController {
  constructor(
    private readonly dailySheetService: DailySheetService,
    private readonly pdfService: DailySheetPdfService,
    private readonly bulkImportService: BulkImportService,
    private readonly storage: StorageService,
  ) {}

  // ── Static routes MUST come before /:id ──────────────────────────────

  @Post('generate')
  @RequirePermissions('daily_sheets:generate')
  @Throttle({ short: { ttl: 1000, limit: 1 }, medium: { ttl: 60000, limit: 3 } })
  generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateSheetsDto) {
    return this.dailySheetService.generate(user.vendorId, dto);
  }

  // Polling a generation job's progress belongs to the generate capability.
  @Get('generation-status/:jobId')
  @RequirePermissions('daily_sheets:generate')
  getGenerationStatus(@Param('jobId') jobId: string) {
    return this.dailySheetService.getGenerationStatus(jobId);
  }

  @Get('driver/:driverId/stats')
  @RequirePermissions('daily_sheets:view')
  getDriverStats(
    @CurrentUser() user: AuthUser,
    @Param('driverId') driverId: string,
    @Query('month') month?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    // DRIVER can only query their own stats
    const resolvedDriverId = user.role === UserRole.DRIVER ? user.userId : driverId;
    return this.dailySheetService.getDriverStats(user.vendorId, resolvedDriverId, {
      month,
      dateFrom,
      dateTo,
    });
  }

  @Get('driver/:driverId')
  @RequirePermissions('daily_sheets:view')
  getSheetsByDriver(
    @CurrentUser() user: AuthUser,
    @Param('driverId') driverId: string,
    @Query('date') date?: string,
  ) {
    return this.dailySheetService.getSheetsByDriver(
      user.vendorId,
      driverId,
      date,
    );
  }

  // ── Delivery Item Notes ───────────────────────────────────────────────────
  // Static note routes MUST come before items/:id to avoid NestJS shadowing.

  /** POST /daily-sheets/items/upload-photo — delivery evidence photo (driver flow). */
  @Post('items/upload-photo')
  @RequirePermissions('daily_sheets:update')
  @Throttle({ short: { ttl: 2000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_DELIVERY_PHOTO_EXTS.includes(extname(file.originalname).toLowerCase())) {
          cb(null, true);
        } else {
          cb(new Error('Only JPG, PNG, WEBP images are allowed for delivery photos'), false);
        }
      },
    }),
  )
  async uploadDeliveryPhoto(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');
    const { key } = await this.storage.upload(
      'delivery-photos',
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    return { key };
  }

  @Get('items/:id/notes')
  @RequirePermissions('daily_sheets:view')
  getItemNotes(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.dailySheetService.getNotes(user.vendorId, id);
  }

  // Note authoring shares daily_sheets:update (see Batch 16 report — accepted broadening).
  @Post('items/:id/notes')
  @RequirePermissions('daily_sheets:update')
  @Throttle({ short: { ttl: 1000, limit: 10 }, medium: { ttl: 60000, limit: 30 } })
  addTextNote(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateDeliveryNoteDto,
  ) {
    return this.dailySheetService.addTextNote(user, id, dto);
  }

  @Post('items/:id/notes/voice')
  @RequirePermissions('daily_sheets:update')
  @Throttle({ short: { ttl: 2000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_AUDIO_MIMES.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error('File type not allowed. Send audio/webm, audio/ogg, audio/mp4, or audio/mpeg.'), false);
        }
      },
    }),
  )
  async addVoiceNote(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
    @Query('duration') duration?: string,
  ) {
    if (!file) throw new BadRequestException('No audio file provided');
    const audioDuration = duration ? parseInt(duration, 10) : undefined;
    return this.dailySheetService.addVoiceNote(user, id, file, audioDuration);
  }

  // Driver-side edit-lock interactions (request/ack) live under :update; the staff
  // override (unlock-edit) is :manage_edit_locks.
  @Patch('items/notes/:noteId/acknowledge')
  @RequirePermissions('daily_sheets:update')
  @Throttle({ short: { ttl: 1000, limit: 20 }, medium: { ttl: 60000, limit: 60 } })
  acknowledgeNote(@CurrentUser() user: AuthUser, @Param('noteId') noteId: string) {
    return this.dailySheetService.acknowledgeNote(user, noteId);
  }

  @Get('items/notes/:noteId/audio')
  @RequirePermissions('daily_sheets:view')
  getNoteAudioUrl(@CurrentUser() user: AuthUser, @Param('noteId') noteId: string) {
    return this.dailySheetService.getNoteAudioUrl(user.vendorId, noteId);
  }

  @Get('items/:id/photo-url')
  @RequirePermissions('daily_sheets:view')
  getDeliveryPhotoUrl(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.dailySheetService.getDeliveryPhotoUrl(user.vendorId, id);
  }

  /** GET /daily-sheets/items/:id/receipt — single delivery receipt PDF (view/print). */
  @Get('items/:id/receipt')
  @RequirePermissions('daily_sheets:view')
  async downloadDeliveryReceipt(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const pdfBuffer = await this.dailySheetService.getDeliveryReceiptPdf(user.vendorId, id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="receipt-${id}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.end(pdfBuffer);
  }

  // Staff override that grants edit access on a locked delivery — NOT a driver capability.
  @Patch('items/:id/unlock-edit')
  @RequirePermissions('daily_sheets:manage_edit_locks')
  @Throttle({ short: { ttl: 1000, limit: 10 }, medium: { ttl: 60000, limit: 30 } })
  unlockDeliveryEdit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UnlockEditDto,
  ) {
    return this.dailySheetService.unlockDeliveryEdit(user, id, dto);
  }

  // Driver requests an unlock on their own delivery → part of the driver edit flow (:update).
  @Patch('items/:id/request-edit')
  @RequirePermissions('daily_sheets:update')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  requestDeliveryEdit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.dailySheetService.requestDeliveryEdit(user, id);
  }

  @Patch('items/:id')
  @RequirePermissions('daily_sheets:update')
  @Throttle({ short: { ttl: 1000, limit: 10 }, medium: { ttl: 60000, limit: 60 } })
  submitDelivery(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SubmitDeliveryDto,
  ) {
    return this.dailySheetService.submitDelivery(user, id, dto);
  }

  // ── Bulk Import — all routes use static 'bulk-import/' prefix ────────

  @Get('bulk-import/template')
  @RequirePermissions('daily_sheets:bulk_import')
  async downloadSheetTemplate(
    @CurrentUser() user: AuthUser,
    @Query('sheetId') sheetId: string,
    @Res() res: Response,
  ) {
    if (!sheetId) throw new BadRequestException('sheetId query parameter is required');
    const buffer = await this.bulkImportService.generateSheetTemplate(sheetId, user.vendorId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="import-template-${sheetId.slice(0, 8)}.xlsx"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Get('bulk-import/global-template')
  @RequirePermissions('daily_sheets:bulk_import')
  async downloadGlobalTemplate(@Res() res: Response) {
    const buffer = await this.bulkImportService.generateGlobalTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="global-import-template.xlsx"');
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Post('bulk-import/preview')
  @RequirePermissions('daily_sheets:bulk_import')
  @Throttle({ short: { ttl: 5000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_EXCEL_MIMES.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error('Only .xlsx files are accepted.'), false);
        }
      },
    }),
  )
  async previewSheetImport(
    @CurrentUser() user: AuthUser,
    @Query('sheetId') sheetId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!sheetId) throw new BadRequestException('sheetId query parameter is required');
    if (!file) throw new BadRequestException('No Excel file provided');
    return this.bulkImportService.previewSheetImport(sheetId, user.vendorId, file);
  }

  @Post('bulk-import/global-preview')
  @RequirePermissions('daily_sheets:bulk_import')
  @Throttle({ short: { ttl: 5000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_EXCEL_MIMES.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error('Only .xlsx files are accepted.'), false);
        }
      },
    }),
  )
  async previewGlobalImport(
    @CurrentUser() user: AuthUser,
    @Query('date') date: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!date) throw new BadRequestException('date query parameter is required (YYYY-MM-DD)');
    if (!file) throw new BadRequestException('No Excel file provided');
    return this.bulkImportService.previewGlobalImport(user.vendorId, date, file);
  }

  @Post('bulk-import/confirm')
  @RequirePermissions('daily_sheets:bulk_import')
  @Throttle({ short: { ttl: 2000, limit: 1 }, medium: { ttl: 60000, limit: 10 } })
  confirmSheetImport(
    @CurrentUser() user: AuthUser,
    @Query('sheetId') sheetId: string,
    @Body() dto: BulkImportConfirmDto,
  ) {
    if (!sheetId) throw new BadRequestException('sheetId query parameter is required');
    return this.bulkImportService.confirmSheetImport(sheetId, user.vendorId, dto);
  }

  @Post('bulk-import/global-confirm')
  @RequirePermissions('daily_sheets:bulk_import')
  @Throttle({ short: { ttl: 2000, limit: 1 }, medium: { ttl: 60000, limit: 10 } })
  confirmGlobalImport(
    @CurrentUser() user: AuthUser,
    @Body() dto: GlobalImportConfirmDto,
  ) {
    return this.bulkImportService.confirmGlobalImport(user.vendorId, dto);
  }

  // ── List + single ─────────────────────────────────────────────────────

  // Was unprotected (no @Roles) → now gated by daily_sheets:view.
  @Get()
  @RequirePermissions('daily_sheets:view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: DailySheetQueryDto) {
    return this.dailySheetService.findAllPaginated(user.vendorId, query);
  }

  @Get('customers/:customerId/delivery-history')
  @RequirePermissions('daily_sheets:view')
  getCustomerDeliveryHistory(
    @CurrentUser() user: AuthUser,
    @Param('customerId') customerId: string,
    @Query('limit') limit?: string,
  ) {
    return this.dailySheetService.getCustomerDeliveryHistory(
      user.vendorId,
      customerId,
      limit ? parseInt(limit, 10) : 6,
    );
  }

  // Customer balance in the delivery/COD context → daily_sheets:view (driver keeps it);
  // distinct from the customer-page financial-summary (customers:view_financial, staff).
  @Get('customers/:customerId/financial-summary')
  @RequirePermissions('daily_sheets:view')
  getCustomerFinancialSummary(
    @CurrentUser() user: AuthUser,
    @Param('customerId') customerId: string,
    @Query('sheetId') sheetId: string,
  ) {
    return this.dailySheetService.getCustomerFinancialSummary(
      user.vendorId,
      customerId,
      sheetId,
    );
  }

  // Pre-close reconciliation preview → daily_sheets:close (staff pre-close review).
  @Get(':id/reconciliation-preview')
  @RequirePermissions('daily_sheets:close')
  getReconciliationPreview(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.dailySheetService.getReconciliationPreview(user.vendorId, id);
  }

  // Was unprotected (no @Roles) → now gated by daily_sheets:view.
  @Get(':id')
  @RequirePermissions('daily_sheets:view')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.dailySheetService.findOne(user.vendorId, id);
  }

  // Item management (from-order/adhoc) shares :update (accepted broadening — Batch 16 report).
  @Post(':id/items/from-order')
  @RequirePermissions('daily_sheets:update')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  insertItemFromOrder(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: InsertOrderItemDto,
  ) {
    return this.dailySheetService.insertItemFromOrder(user.vendorId, id, dto);
  }

  @Post(':id/items/adhoc')
  @RequirePermissions('daily_sheets:update')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  addAdhocItem(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AddAdhocItemDto,
  ) {
    return this.dailySheetService.addAdhocItem(user, id, dto);
  }

  // Financial correction entry — admin-only (dedicated permission).
  @Post(':id/items/correction')
  @RequirePermissions('daily_sheets:correct')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  addCorrectionItem(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AddCorrectionItemDto,
  ) {
    return this.dailySheetService.addCorrectionItem(user, id, dto);
  }

  // ── Sheet lifecycle ───────────────────────────────────────────────────

  @Patch(':id/load-out')
  @RequirePermissions('daily_sheets:load_out')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  loadOut(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: LoadOutDto,
  ) {
    return this.dailySheetService.loadOut(user.vendorId, id, dto);
  }

  @Patch(':id/check-in')
  @RequirePermissions('daily_sheets:check_in')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  checkIn(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CheckInDto,
  ) {
    return this.dailySheetService.checkIn(user.vendorId, id, dto);
  }

  @Post(':id/close')
  @RequirePermissions('daily_sheets:close')
  @Throttle({ short: { ttl: 1000, limit: 1 }, medium: { ttl: 60000, limit: 3 } })
  closeSheet(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.dailySheetService.closeSheet(user.vendorId, id);
  }

  @Patch(':id/swap-assignment')
  @RequirePermissions('daily_sheets:swap_assignment')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  swapAssignment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SwapDriverDto,
  ) {
    return this.dailySheetService.swapAssignment(user.vendorId, id, dto);
  }

  /**
   * POST /daily-sheets/:id/confirm-crew
   * Confirms today's crew — mandatory before any trip can start.
   */
  @Post(':id/confirm-crew')
  @RequirePermissions('daily_sheets:confirm_crew')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  confirmCrew(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.dailySheetService.confirmCrew(user.vendorId, id, user);
  }

  // ── Load trips (multi-trip per sheet) — driver + staff ───────────────

  @Post(':id/loads')
  @RequirePermissions('daily_sheets:load_out')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  createLoad(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateLoadDto,
  ) {
    return this.dailySheetService.createLoad(user.vendorId, id, dto);
  }

  @Patch(':id/loads/:loadId/checkin')
  @RequirePermissions('daily_sheets:check_in')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  checkinLoad(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('loadId') loadId: string,
    @Body() dto: CheckinLoadDto,
  ) {
    return this.dailySheetService.checkinLoad(user.vendorId, id, loadId, dto);
  }

  @Get(':id/loads')
  @RequirePermissions('daily_sheets:view')
  getLoads(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.dailySheetService.getLoads(user.vendorId, id);
  }

  /** GET /daily-sheets/:id/invoice — inline PDF invoice (driver + staff, a read). */
  @Get(':id/invoice')
  @RequirePermissions('daily_sheets:view')
  async exportInvoice(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const sheet = await this.dailySheetService.findOne(user.vendorId, id);
    const pdfBuffer = await this.pdfService.generate(sheet);

    const dateStr = new Date(sheet.date).toISOString().split('T')[0];
    const filename = `invoice-${dateStr}-${(sheet as any).van?.plateNumber ?? id}.pdf`
      .replace(/\s+/g, '-')
      .toLowerCase();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.end(pdfBuffer);
  }

  /** GET /daily-sheets/:id/export — downloadable full-sheet PDF (staff). */
  @Get(':id/export')
  @RequirePermissions('daily_sheets:export')
  async exportPdf(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const sheet = await this.dailySheetService.findOne(user.vendorId, id);
    const pdfBuffer = await this.pdfService.generate(sheet);

    const dateStr = new Date(sheet.date).toISOString().split('T')[0];
    const filename = `sheet-${dateStr}-${sheet.route?.name ?? id}.pdf`
      .replace(/\s+/g, '-')
      .toLowerCase();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.end(pdfBuffer);
  }
}
