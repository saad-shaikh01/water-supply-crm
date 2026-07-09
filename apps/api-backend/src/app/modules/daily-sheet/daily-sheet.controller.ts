import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Query,
  Res,
  UseGuards,
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
import { MoveDeliveryItemsDto } from './dto/move-delivery-items.dto';
import { UnlockEditDto } from './dto/unlock-edit.dto';
import { CreateDeliveryNoteDto } from './dto/create-delivery-note.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

const ALLOWED_AUDIO_MIMES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-m4a'];
const ALLOWED_EXCEL_MIMES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];
const ALLOWED_DELIVERY_PHOTO_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

@Controller('daily-sheets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DailySheetController {
  constructor(
    private readonly dailySheetService: DailySheetService,
    private readonly pdfService: DailySheetPdfService,
    private readonly bulkImportService: BulkImportService,
    private readonly storage: StorageService,
  ) {}

  // ── Static routes MUST come before /:id ──────────────────────────────

  @Post('generate')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 1 }, medium: { ttl: 60000, limit: 3 } })
  generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateSheetsDto) {
    return this.dailySheetService.generate(user.vendorId, dto);
  }

  @Get('generation-status/:jobId')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  getGenerationStatus(@Param('jobId') jobId: string) {
    return this.dailySheetService.getGenerationStatus(jobId);
  }

  @Get('driver/:driverId/stats')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
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
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
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

  /**
   * GET /daily-sheets/destination-options?date=YYYY-MM-DD
   * Per-active-van projection for the move-customer destination picker:
   * whether a sheet already exists for that van+date, and whether it's
   * closed — lets the frontend render "will create new sheet" / "adds to
   * open sheet" / "unavailable (closed)" without N+1 requests.
   */
  @Get('destination-options')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  getDestinationOptions(@CurrentUser() user: AuthUser, @Query('date') date: string) {
    if (!date) throw new BadRequestException('date query parameter is required (YYYY-MM-DD)');
    return this.dailySheetService.getDestinationOptions(user.vendorId, date);
  }

  // ── Delivery Item Notes ───────────────────────────────────────────────────
  // Static note routes MUST come before items/:id to avoid NestJS shadowing.

  /**
   * PATCH /daily-sheets/items/move
   * Moves one or more customers' pending/failed deliveries to a different
   * van's sheet (same date or a future date), auto-creating the destination
   * sheet if it doesn't exist yet. Must stay before items/:id (line below).
   */
  @Patch('items/move')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  moveDeliveryItems(@CurrentUser() user: AuthUser, @Body() dto: MoveDeliveryItemsDto) {
    return this.dailySheetService.moveDeliveryItems(user, dto);
  }

  /**
   * POST /daily-sheets/items/upload-photo
   * Upload a single "unable to deliver" evidence photo to Wasabi.
   * Returns { key } — store the key in SubmitDeliveryDto.photoKey.
   */
  @Post('items/upload-photo')
  @Roles(UserRole.DRIVER, UserRole.STAFF, UserRole.VENDOR_ADMIN)
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
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  getItemNotes(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.dailySheetService.getNotes(user.vendorId, id);
  }

  @Post('items/:id/notes')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 10 }, medium: { ttl: 60000, limit: 30 } })
  addTextNote(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateDeliveryNoteDto,
  ) {
    return this.dailySheetService.addTextNote(user, id, dto);
  }

  @Post('items/:id/notes/voice')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
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

  @Patch('items/notes/:noteId/acknowledge')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  @Throttle({ short: { ttl: 1000, limit: 20 }, medium: { ttl: 60000, limit: 60 } })
  acknowledgeNote(@CurrentUser() user: AuthUser, @Param('noteId') noteId: string) {
    return this.dailySheetService.acknowledgeNote(user, noteId);
  }

  @Get('items/notes/:noteId/audio')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  getNoteAudioUrl(@CurrentUser() user: AuthUser, @Param('noteId') noteId: string) {
    return this.dailySheetService.getNoteAudioUrl(user.vendorId, noteId);
  }

  @Get('items/:id/photo-url')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  getDeliveryPhotoUrl(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.dailySheetService.getDeliveryPhotoUrl(user.vendorId, id);
  }

  /**
   * GET /api/daily-sheets/items/:id/receipt
   * Downloads a single delivery's receipt/invoice PDF.
   * Roles: VENDOR_ADMIN, STAFF, DRIVER
   */
  @Get('items/:id/receipt')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
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

  @Patch('items/:id/unlock-edit')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 10 }, medium: { ttl: 60000, limit: 30 } })
  unlockDeliveryEdit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UnlockEditDto,
  ) {
    return this.dailySheetService.unlockDeliveryEdit(user, id, dto);
  }

  @Patch('items/:id/request-edit')
  @Roles(UserRole.DRIVER)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  requestDeliveryEdit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.dailySheetService.requestDeliveryEdit(user, id);
  }

  @Patch('items/:id')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  @Throttle({ short: { ttl: 1000, limit: 10 }, medium: { ttl: 60000, limit: 60 } })
  submitDelivery(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SubmitDeliveryDto,
  ) {
    return this.dailySheetService.submitDelivery(user, id, dto);
  }

  // ── Bulk Import — all routes use static 'bulk-import/' prefix ────────
  // Static prefix guarantees NestJS resolves these before any /:id routes.

  @Get('bulk-import/template')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
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
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  async downloadGlobalTemplate(@Res() res: Response) {
    const buffer = await this.bulkImportService.generateGlobalTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="global-import-template.xlsx"');
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Post('bulk-import/preview')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
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
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
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
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
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
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 2000, limit: 1 }, medium: { ttl: 60000, limit: 10 } })
  confirmGlobalImport(
    @CurrentUser() user: AuthUser,
    @Body() dto: GlobalImportConfirmDto,
  ) {
    return this.bulkImportService.confirmGlobalImport(user.vendorId, dto);
  }

  // ── List + single ─────────────────────────────────────────────────────

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query() query: DailySheetQueryDto) {
    return this.dailySheetService.findAllPaginated(user.vendorId, query);
  }

  @Get('customers/:customerId/delivery-history')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
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

  @Get('customers/:customerId/financial-summary')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
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

  /**
   * GET /api/daily-sheets/:id/reconciliation-preview
   * Returns reconciliation breakdown WITHOUT closing the sheet.
   * Used to show the confirmation dialog before close.
   */
  @Get(':id/reconciliation-preview')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  getReconciliationPreview(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.dailySheetService.getReconciliationPreview(user.vendorId, id);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.dailySheetService.findOne(user.vendorId, id);
  }

  @Post(':id/items/from-order')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  insertItemFromOrder(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: InsertOrderItemDto,
  ) {
    return this.dailySheetService.insertItemFromOrder(user.vendorId, id, dto);
  }

  @Post(':id/items/adhoc')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  addAdhocItem(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AddAdhocItemDto,
  ) {
    return this.dailySheetService.addAdhocItem(user, id, dto);
  }

  @Post(':id/items/correction')
  @Roles(UserRole.VENDOR_ADMIN)
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
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  loadOut(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: LoadOutDto,
  ) {
    return this.dailySheetService.loadOut(user.vendorId, id, dto);
  }

  @Patch(':id/check-in')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  checkIn(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CheckInDto,
  ) {
    return this.dailySheetService.checkIn(user.vendorId, id, dto);
  }

  @Post(':id/close')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 1 }, medium: { ttl: 60000, limit: 3 } })
  closeSheet(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.dailySheetService.closeSheet(user.vendorId, id);
  }

  @Patch(':id/swap-assignment')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
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
   * Any later driver/crew change resets the confirmation.
   */
  @Post(':id/confirm-crew')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  confirmCrew(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.dailySheetService.confirmCrew(user.vendorId, id, user);
  }

  // ── Load trips (multi-trip per sheet) ────────────────────────────────

  @Post(':id/loads')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  createLoad(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateLoadDto,
  ) {
    return this.dailySheetService.createLoad(user.vendorId, id, dto);
  }

  @Patch(':id/loads/:loadId/checkin')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
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
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  getLoads(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.dailySheetService.getLoads(user.vendorId, id);
  }

  /**
   * GET /api/daily-sheets/:id/invoice
   * Opens an inline PDF invoice (all items with address/wallet detail).
   * Roles: VENDOR_ADMIN, STAFF, DRIVER
   */
  @Get(':id/invoice')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
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

  /**
   * GET /api/daily-sheets/:id/export
   * Downloads a PDF of the daily sheet (A4, printable).
   * Roles: VENDOR_ADMIN, STAFF
   */
  @Get(':id/export')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
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
