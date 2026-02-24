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
} from '@nestjs/common';
import { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { DailySheetService } from './daily-sheet.service';
import { DailySheetPdfService } from './pdf/daily-sheet-pdf.service';
import { GenerateSheetsDto } from './dto/generate-sheets.dto';
import { SubmitDeliveryDto } from './dto/submit-delivery.dto';
import { LoadOutDto } from './dto/load-out.dto';
import { CheckInDto } from './dto/check-in.dto';
import { SwapDriverDto } from './dto/swap-driver.dto';
import { CreateLoadDto } from './dto/create-load.dto';
import { CheckinLoadDto } from './dto/checkin-load.dto';
import { DailySheetQueryDto } from './dto/daily-sheet-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('daily-sheets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DailySheetController {
  constructor(
    private readonly dailySheetService: DailySheetService,
    private readonly pdfService: DailySheetPdfService,
  ) {}

  // ── Static routes MUST come before /:id ──────────────────────────────

  @Post('generate')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 1 }, medium: { ttl: 60000, limit: 3 } })
  generate(@CurrentUser() user: any, @Body() dto: GenerateSheetsDto) {
    return this.dailySheetService.generate(user.vendorId, dto);
  }

  @Get('generation-status/:jobId')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  getGenerationStatus(@Param('jobId') jobId: string) {
    return this.dailySheetService.getGenerationStatus(jobId);
  }

  @Get('driver/:driverId')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  getSheetsByDriver(
    @CurrentUser() user: any,
    @Param('driverId') driverId: string,
    @Query('date') date?: string,
  ) {
    return this.dailySheetService.getSheetsByDriver(
      user.vendorId,
      driverId,
      date,
    );
  }

  @Patch('items/:id')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  @Throttle({ short: { ttl: 1000, limit: 10 }, medium: { ttl: 60000, limit: 60 } })
  submitDelivery(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: SubmitDeliveryDto,
  ) {
    return this.dailySheetService.submitDelivery(user.vendorId, id, dto);
  }

  // ── List + single ─────────────────────────────────────────────────────

  @Get()
  findAll(@CurrentUser() user: any, @Query() query: DailySheetQueryDto) {
    return this.dailySheetService.findAllPaginated(user.vendorId, query);
  }

  /**
   * GET /api/daily-sheets/:id/reconciliation-preview
   * Returns reconciliation breakdown WITHOUT closing the sheet.
   * Used to show the confirmation dialog before close.
   */
  @Get(':id/reconciliation-preview')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  getReconciliationPreview(@CurrentUser() user: any, @Param('id') id: string) {
    return this.dailySheetService.getReconciliationPreview(user.vendorId, id);
  }

  @Get(':id')
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.dailySheetService.findOne(user.vendorId, id);
  }

  // ── Sheet lifecycle ───────────────────────────────────────────────────

  @Patch(':id/load-out')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  loadOut(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: LoadOutDto,
  ) {
    return this.dailySheetService.loadOut(user.vendorId, id, dto);
  }

  @Patch(':id/check-in')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  checkIn(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: CheckInDto,
  ) {
    return this.dailySheetService.checkIn(user.vendorId, id, dto);
  }

  @Post(':id/close')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  @Throttle({ short: { ttl: 1000, limit: 1 }, medium: { ttl: 60000, limit: 3 } })
  closeSheet(@CurrentUser() user: any, @Param('id') id: string) {
    return this.dailySheetService.closeSheet(user.vendorId, id);
  }

  @Patch(':id/swap-assignment')
  @Roles(UserRole.VENDOR_ADMIN)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 10 } })
  swapAssignment(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: SwapDriverDto,
  ) {
    return this.dailySheetService.swapAssignment(user.vendorId, id, dto);
  }

  // ── Load trips (multi-trip per sheet) ────────────────────────────────

  @Post(':id/loads')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  createLoad(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: CreateLoadDto,
  ) {
    return this.dailySheetService.createLoad(user.vendorId, id, dto);
  }

  @Patch(':id/loads/:loadId/checkin')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 20 } })
  checkinLoad(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Param('loadId') loadId: string,
    @Body() dto: CheckinLoadDto,
  ) {
    return this.dailySheetService.checkinLoad(user.vendorId, id, loadId, dto);
  }

  @Get(':id/loads')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.DRIVER)
  getLoads(@CurrentUser() user: any, @Param('id') id: string) {
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
    @CurrentUser() user: any,
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
    @CurrentUser() user: any,
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
