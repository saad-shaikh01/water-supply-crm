import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@water-supply-crm/database';
import { LedgerService } from '../transaction/ledger.service';
import { AuditService } from '../audit/audit.service';
import { BulkImportConfirmDto, ImportRowDto } from './dto/bulk-import-confirm.dto';
import { GlobalImportConfirmDto, AdhocImportRowDto } from './dto/global-import-confirm.dto';
import {
  SanitizedSheetRow,
  SanitizedGlobalRow,
  PreviewRowResult,
  AdhocPreviewRow,
  AmbiguousPreviewRow,
  SheetImportPreviewResponse,
  GlobalPreviewGroup,
  GlobalImportPreviewResponse,
  SheetImportConfirmResponse,
  GlobalImportConfirmResponse,
  SheetItemForPreview,
} from './bulk-import.types';

type SanitizedGlobalRowWithIndex = SanitizedGlobalRow & { rowIndex: number };

const HEADER_ALIASES: Record<string, string[]> = {
  ItemID: ['itemid', 'item_id', 'itemid'],
  CustomerCode: ['customercode', 'customer_code', 'code'],
  CustomerName: ['customername', 'customer_name'],
  Product: ['product', 'productname', 'product_name'],
  Status: ['status'],
  FilledDropped: ['filledDropped', 'filled_dropped', 'filledDropped'],
  EmptyReturned: ['emptyreturned', 'empty_returned', 'emptyreceived', 'empty_received'],
  CashCollected: ['cashcollected', 'cash_collected', 'cash'],
  FailureReason: ['failurereason', 'failure_reason', 'reason', 'notes'],
  DeliveryDate: ['deliverydate', 'delivery_date', 'date'],
  VanPlateNumber: ['vanplatenumber', 'van_plate_number', 'van', 'platenumber', 'plate'],
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCIENTIFIC_NOTATION_PATTERN = /^\d+\.?\d*[eE][+\-]?\d+$/;
const TERMINAL_WRITTEN = ['COMPLETED', 'EMPTY_ONLY'];

@Injectable()
export class BulkImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  // ── Private utilities ────────────────────────────────────────────────────

  private sanitizeCellValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (
      typeof value === 'object' &&
      value !== null &&
      'richText' in value &&
      Array.isArray((value as any).richText)
    ) {
      return (value as { richText: Array<{ text?: string }> }).richText
        .map((r) => r.text ?? '')
        .join('')
        .trim();
    }
    return String(value).trim();
  }

  private parseNonNegativeInt(value: unknown): { value: number; warning?: string } {
    if (value === null || value === undefined || value === '') return { value: 0 };
    if (typeof value === 'number') return { value: Math.max(0, Math.round(value)) };
    const raw = this.sanitizeCellValue(value);
    if (raw === '') return { value: 0 };
    const stripped = raw.replace(/[^0-9\-]/g, '');
    const parsed = parseInt(stripped, 10);
    if (isNaN(parsed)) {
      return { value: 0, warning: `"${raw}" could not be parsed as an integer, defaulted to 0` };
    }
    return { value: Math.max(0, Math.round(parsed)) };
  }

  private parseNonNegativeDecimal(value: unknown): { value: number; warning?: string } {
    if (value === null || value === undefined || value === '') return { value: 0 };
    if (typeof value === 'number') return { value: Math.max(0, value) };
    const raw = this.sanitizeCellValue(value);
    if (raw === '') return { value: 0 };
    const stripped = raw.replace(/[^0-9.\-]/g, '');
    if ((stripped.match(/\./g) ?? []).length > 1) {
      return { value: 0, warning: `"${raw}" has invalid decimal format, defaulted to 0` };
    }
    const parsed = parseFloat(stripped);
    if (isNaN(parsed)) {
      return { value: 0, warning: `"${raw}" could not be parsed as a decimal, defaulted to 0` };
    }
    return { value: Math.max(0, parsed) };
  }

  private resolveColumnIndex(
    headerRow: ExcelJS.Row,
    required: string[],
    optional: string[] = [],
  ): Record<string, number> {
    const map: Record<string, number> = {};
    headerRow.eachCell((cell, colNum) => {
      const normalized = this.sanitizeCellValue(cell.value)
        .toLowerCase()
        .replace(/\s+/g, '');
      for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
        if (aliases.some((a) => a.toLowerCase().replace(/\s+/g, '') === normalized)) {
          map[key] = colNum;
          break;
        }
      }
    });
    const missing = required.filter((h) => !(h in map));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Missing required columns: ${missing.join(', ')}. Re-download the official template.`,
      );
    }
    return map;
  }

  private buildFallbackMap(items: SheetItemForPreview[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const item of items) {
      const key = `${item.customer.customerCode}::${item.product.name}`.toLowerCase();
      map.set(key, item.id);
    }
    return map;
  }

  private resolveItemId(
    rawItemId: string,
    customerCode: string,
    productName: string,
    fallbackMap: Map<string, string>,
  ): string | null {
    if (UUID_PATTERN.test(rawItemId)) return rawItemId;
    const key = `${customerCode}::${productName}`.toLowerCase();
    return fallbackMap.get(key) ?? null;
  }

  private validateRowFields(
    row: SanitizedSheetRow,
    dbItem: SheetItemForPreview | undefined,
  ): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const ALLOWED = ['COMPLETED', 'SKIPPED', 'FAILED'];

    if (!ALLOWED.includes(row.status)) {
      errors.push(
        `Status "${row.status}" is not valid. Allowed values: COMPLETED, SKIPPED, FAILED.`,
      );
      return { errors, warnings };
    }

    if (row.status === 'SKIPPED' || row.status === 'FAILED') {
      if (row.filledDropped > 0 || row.emptyReturned > 0 || row.cashCollected > 0) {
        errors.push(
          `Status is ${row.status} but delivery values are non-zero. ` +
            `Set FilledDropped, EmptyReturned, and CashCollected to 0 when not delivering.`,
        );
      }
      if (row.status === 'FAILED' && !row.failureReason?.trim()) {
        errors.push('A failure reason is required for FAILED status.');
      }
      if (row.status === 'SKIPPED' && !row.failureReason?.trim()) {
        warnings.push('Consider adding a reason for skipped deliveries.');
      }
    }

    if (
      dbItem &&
      TERMINAL_WRITTEN.includes(dbItem.status) &&
      (row.status === 'SKIPPED' || row.status === 'FAILED')
    ) {
      errors.push(
        `This delivery is already recorded as ${dbItem.status}. ` +
          `Changing to ${row.status} via bulk import is not permitted — edit manually to reverse a completed delivery.`,
      );
    }

    for (const w of row.sanitizationWarnings) {
      warnings.push(w);
    }

    return { errors, warnings };
  }

  private buildPreviewRowResult(
    rowIndex: number,
    sanitized: SanitizedSheetRow,
    resolvedItemId: string | null,
    dbItem: SheetItemForPreview | undefined,
    itemErrors: string[],
  ): PreviewRowResult {
    const { errors: fieldErrors, warnings } = this.validateRowFields(sanitized, dbItem);
    return {
      rowIndex,
      itemId: resolvedItemId,
      customerName: sanitized.customerName || dbItem?.customer.name || '',
      customerCode: sanitized.customerCode,
      productName: sanitized.productName,
      currentDbStatus: dbItem?.status ?? 'UNKNOWN',
      importStatus: sanitized.status,
      filledDropped: sanitized.filledDropped,
      emptyReturned: sanitized.emptyReturned,
      cashCollected: sanitized.cashCollected,
      failureReason: sanitized.failureReason,
      errors: [...itemErrors, ...fieldErrors],
      warnings,
    };
  }

  private async fetchSheetItemsForPreview(sheetId: string): Promise<SheetItemForPreview[]> {
    return this.prisma.dailySheetItem.findMany({
      where: { dailySheetId: sheetId, isCorrection: false },
      select: {
        id: true,
        customerId: true,
        productId: true,
        status: true,
        customer: {
          select: {
            customerCode: true,
            name: true,
            isBillingExempt: true,
            customPrices: { select: { productId: true, customPrice: true } },
          },
        },
        product: { select: { name: true, basePrice: true } },
      },
    }) as Promise<SheetItemForPreview[]>;
  }

  private async applyImportRow(
    tx: Prisma.TransactionClient,
    row: ImportRowDto,
    sheet: { id: string; date: Date; vendorId: string },
    dbItems: SheetItemForPreview[],
    vendorId: string,
  ): Promise<void> {
    const dbItem = dbItems.find((i) => i.id === row.itemId);
    if (!dbItem) {
      throw new BadRequestException(`Item ${row.itemId} not found in sheet`);
    }

    const resolvedStatus =
      row.status === 'COMPLETED' && row.filledDropped === 0 ? 'EMPTY_ONLY' : row.status;
    const isDelivered = resolvedStatus === 'COMPLETED' || resolvedStatus === 'EMPTY_ONLY';

    const customPrice = dbItem.customer.customPrices.find(
      (p) => p.productId === dbItem.productId,
    );
    const price = dbItem.customer.isBillingExempt
      ? 0
      : (customPrice?.customPrice ?? dbItem.product.basePrice);

    await tx.dailySheetItem.update({
      where: { id: row.itemId },
      data: {
        status: resolvedStatus as any,
        filledDropped: row.filledDropped,
        emptyReceived: row.emptyReturned,
        cashCollected: row.cashCollected,
        reason: row.failureReason ?? null,
        failureCategory: row.failureCategory ?? null,
        pricePerBottle: price,
        deliveredAt: isDelivered ? sheet.date : null,
        editUnlockedBy: null,
        editUnlockExpiresAt: null,
      },
    });

    if (isDelivered) {
      await this.ledger.recordDelivery(
        {
          vendorId,
          customerId: dbItem.customerId,
          productId: dbItem.productId,
          dailySheetId: sheet.id,
          dailySheetItemId: row.itemId,
          filledDropped: row.filledDropped,
          emptyReceived: row.emptyReturned,
          cashCollected: row.cashCollected,
          pricePerBottle: price,
        },
        tx,
      );
    }
  }

  // ── Template generation ──────────────────────────────────────────────────

  async generateSheetTemplate(sheetId: string, vendorId: string): Promise<Buffer> {
    const sheet = await this.prisma.dailySheet.findFirst({
      where: { id: sheetId, vendorId, isClosed: false },
      include: {
        items: {
          where: { isCorrection: false },
          orderBy: { sequence: 'asc' },
          include: {
            customer: { select: { customerCode: true, name: true } },
            product: { select: { name: true } },
          },
        },
      },
    });

    if (!sheet) {
      throw new NotFoundException('Daily sheet not found or is already closed');
    }

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Deliveries');

    ws.columns = [
      { header: 'ItemID', key: 'itemId', width: 8 },
      { header: 'CustomerCode', key: 'customerCode', width: 14 },
      { header: 'CustomerName', key: 'customerName', width: 26 },
      { header: 'Product', key: 'product', width: 18 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'FilledDropped', key: 'filledDropped', width: 14 },
      { header: 'EmptyReturned', key: 'emptyReturned', width: 14 },
      { header: 'CashCollected', key: 'cashCollected', width: 14 },
      { header: 'FailureReason', key: 'failureReason', width: 32 },
    ];

    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
    headerRow.eachCell((cell) => { cell.protection = { locked: true }; });
    headerRow.commit();

    ws.views = [{ state: 'frozen', ySplit: 1 }];

    for (const item of sheet.items) {
      const row = ws.addRow({
        itemId: item.id,
        customerCode: item.customer.customerCode,
        customerName: item.customer.name,
        product: item.product.name,
        status: 'COMPLETED',
        filledDropped: 0,
        emptyReturned: 0,
        cashCollected: 0,
        failureReason: '',
      });

      for (let col = 1; col <= 4; col++) {
        row.getCell(col).protection = { locked: true };
        row.getCell(col).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF2F2F2' },
        };
      }
      for (let col = 5; col <= 9; col++) {
        row.getCell(col).protection = { locked: false };
      }
      row.commit();
    }

    ws.getColumn(1).numFmt = '@';
    ws.getColumn(1).hidden = true;

    await ws.protect('', {
      selectLockedCells: false,
      selectUnlockedCells: true,
      deleteColumns: false,
      deleteRows: false,
      insertColumns: false,
      formatColumns: false,
    });

    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  }

  async generateGlobalTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Global Deliveries');

    ws.columns = [
      { header: 'CustomerCode', key: 'customerCode', width: 14 },
      { header: 'CustomerName', key: 'customerName', width: 26 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'FilledDropped', key: 'filledDropped', width: 14 },
      { header: 'EmptyReturned', key: 'emptyReturned', width: 14 },
      { header: 'CashCollected', key: 'cashCollected', width: 14 },
      { header: 'FailureReason', key: 'failureReason', width: 32 },
    ];

    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE2CC' } };
    headerRow.commit();

    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const sampleRow = ws.addRow({
      customerCode: 'C-0001',
      customerName: 'Customer Name',
      status: 'COMPLETED',
      filledDropped: 0,
      emptyReturned: 0,
      cashCollected: 0,
      failureReason: '',
    });
    sampleRow.font = { italic: true, color: { argb: 'FF999999' } };
    sampleRow.commit();

    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  }

  // ── Phase 1: Preview ─────────────────────────────────────────────────────

  async previewSheetImport(
    sheetId: string,
    vendorId: string,
    file: Express.Multer.File,
  ): Promise<SheetImportPreviewResponse> {
    const sheet = await this.prisma.dailySheet.findFirst({
      where: { id: sheetId, vendorId },
      select: { id: true, isClosed: true },
    });
    if (!sheet) throw new NotFoundException('Daily sheet not found');
    if (sheet.isClosed) {
      throw new ConflictException('This sheet is closed and cannot accept imports');
    }

    const workbook = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(file.buffer as any);
    const ws = workbook.getWorksheet(1);
    if (!ws) throw new BadRequestException('No worksheet found in the uploaded file');

    const REQUIRED = [
      'CustomerCode', 'Product', 'Status', 'FilledDropped', 'EmptyReturned', 'CashCollected',
    ];
    const colIndex = this.resolveColumnIndex(ws.getRow(1), REQUIRED, ['ItemID', 'CustomerName', 'FailureReason']);

    const dbItems = await this.fetchSheetItemsForPreview(sheetId);
    const fallbackMap = this.buildFallbackMap(dbItems);
    const dbItemMap = new Map(dbItems.map((i) => [i.id, i]));

    const valid: PreviewRowResult[] = [];
    const invalid: PreviewRowResult[] = [];

    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return;

      const allEmpty = [
        colIndex['CustomerCode'],
        colIndex['Status'],
        colIndex['FilledDropped'],
      ].every((col) => col && !this.sanitizeCellValue(row.getCell(col).value));
      if (allEmpty) return;

      const rawItemId = colIndex['ItemID']
        ? this.sanitizeCellValue(row.getCell(colIndex['ItemID']).value)
        : '';
      const fResult = this.parseNonNegativeInt(row.getCell(colIndex['FilledDropped']).value);
      const eResult = this.parseNonNegativeInt(row.getCell(colIndex['EmptyReturned']).value);
      const cResult = this.parseNonNegativeDecimal(row.getCell(colIndex['CashCollected']).value);

      const sanitized: SanitizedSheetRow = {
        itemId: rawItemId,
        customerCode: this.sanitizeCellValue(row.getCell(colIndex['CustomerCode']).value),
        customerName: colIndex['CustomerName']
          ? this.sanitizeCellValue(row.getCell(colIndex['CustomerName']).value)
          : '',
        productName: this.sanitizeCellValue(row.getCell(colIndex['Product']).value),
        status: this.sanitizeCellValue(row.getCell(colIndex['Status']).value).toUpperCase().replace(/\s+/g, ''),
        filledDropped: fResult.value,
        emptyReturned: eResult.value,
        cashCollected: cResult.value,
        failureReason: colIndex['FailureReason']
          ? this.sanitizeCellValue(row.getCell(colIndex['FailureReason']).value) || undefined
          : undefined,
        sanitizationWarnings: [fResult.warning, eResult.warning, cResult.warning].filter(
          Boolean,
        ) as string[],
      };

      const itemErrors: string[] = [];
      let resolvedItemId: string | null = null;

      if (SCIENTIFIC_NOTATION_PATTERN.test(sanitized.itemId)) {
        itemErrors.push(
          'ItemID appears corrupted by Excel (scientific notation detected). Re-download the template.',
        );
      } else {
        resolvedItemId = this.resolveItemId(
          sanitized.itemId,
          sanitized.customerCode,
          sanitized.productName,
          fallbackMap,
        );
        if (!resolvedItemId) {
          itemErrors.push(
            `Could not identify customer "${sanitized.customerCode}" / product "${sanitized.productName}" in this sheet.`,
          );
        }
      }

      const dbItem = resolvedItemId ? dbItemMap.get(resolvedItemId) : undefined;
      const result = this.buildPreviewRowResult(rowNum, sanitized, resolvedItemId, dbItem, itemErrors);

      if (result.errors.length > 0) invalid.push(result);
      else valid.push(result);
    });

    return {
      sheetId,
      valid,
      invalid,
      summary: { total: valid.length + invalid.length, valid: valid.length, invalid: invalid.length },
    };
  }

  async previewGlobalImport(
    vendorId: string,
    date: string,
    file: Express.Multer.File,
  ): Promise<GlobalImportPreviewResponse> {
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
      throw new BadRequestException(`Invalid date "${date}". Use YYYY-MM-DD.`);
    }
    const dateStr = dateObj.toISOString().slice(0, 10);
    const startOfDay = new Date(dateStr); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(dateStr); endOfDay.setHours(23, 59, 59, 999);

    const workbook = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(file.buffer as any);
    const ws = workbook.getWorksheet(1);
    if (!ws) throw new BadRequestException('No worksheet found in the uploaded file');

    const REQUIRED = ['CustomerCode', 'Status', 'FilledDropped', 'EmptyReturned', 'CashCollected'];
    const colIndex = this.resolveColumnIndex(ws.getRow(1), REQUIRED, ['CustomerName', 'FailureReason']);

    // ── Step 1: Parse all raw rows flat ─────────────────────────────────────
    interface RawGlobalRow {
      rowIndex: number;
      customerCode: string;
      customerName: string;
      status: string;
      filledDropped: number;
      emptyReturned: number;
      cashCollected: number;
      failureReason?: string;
      sanitizationWarnings: string[];
    }

    const rawRows: RawGlobalRow[] = [];
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const rawCode = this.sanitizeCellValue(row.getCell(colIndex['CustomerCode']).value).toUpperCase();
      if (!rawCode) return;

      const fResult = this.parseNonNegativeInt(row.getCell(colIndex['FilledDropped']).value);
      const eResult = this.parseNonNegativeInt(row.getCell(colIndex['EmptyReturned']).value);
      const cResult = this.parseNonNegativeDecimal(row.getCell(colIndex['CashCollected']).value);

      rawRows.push({
        rowIndex: rowNum,
        customerCode: rawCode,
        customerName: colIndex['CustomerName']
          ? this.sanitizeCellValue(row.getCell(colIndex['CustomerName']).value)
          : '',
        status: this.sanitizeCellValue(row.getCell(colIndex['Status']).value).toUpperCase().replace(/\s+/g, ''),
        filledDropped: fResult.value,
        emptyReturned: eResult.value,
        cashCollected: cResult.value,
        failureReason: colIndex['FailureReason']
          ? this.sanitizeCellValue(row.getCell(colIndex['FailureReason']).value) || undefined
          : undefined,
        sanitizationWarnings: [fResult.warning, eResult.warning, cResult.warning].filter(Boolean) as string[],
      });
    });

    // ── Step 2: Batch-resolve customers ──────────────────────────────────────
    const uniqueCodes = [...new Set(rawRows.map((r) => r.customerCode).filter(Boolean))];
    const customers = await this.prisma.customer.findMany({
      where: { customerCode: { in: uniqueCodes }, vendorId },
      select: { id: true, customerCode: true },
    });
    const codeToCustomerId = new Map(customers.map((c) => [c.customerCode, c.id]));

    // ── Step 3: Batch-fetch DailySheetItems for the selected date ────────────
    type ResolvedSheetItem = {
      id: string;
      customerId: string;
      productId: string;
      status: string;
      customer: {
        customerCode: string;
        name: string;
        isBillingExempt: boolean;
        customPrices: Array<{ productId: string; customPrice: number }>;
      };
      product: { name: string; basePrice: number };
      dailySheetId: string;
      dailySheet: {
        id: string;
        date: Date;
        isClosed: boolean;
        van: { plateNumber: string };
      };
    };

    const resolvedCustomerIds = customers.map((c) => c.id);
    let allSheetItems: ResolvedSheetItem[] = [];

    if (resolvedCustomerIds.length > 0) {
      allSheetItems = (await this.prisma.dailySheetItem.findMany({
        where: {
          customerId: { in: resolvedCustomerIds },
          isCorrection: false,
          dailySheet: { vendorId, date: { gte: startOfDay, lte: endOfDay } },
        },
        select: {
          id: true,
          customerId: true,
          productId: true,
          status: true,
          customer: {
            select: {
              customerCode: true,
              name: true,
              isBillingExempt: true,
              customPrices: { select: { productId: true, customPrice: true } },
            },
          },
          product: { select: { name: true, basePrice: true } },
          dailySheetId: true,
          dailySheet: {
            select: {
              id: true,
              date: true,
              isClosed: true,
              van: { select: { plateNumber: true } },
            },
          },
        },
      })) as ResolvedSheetItem[];
    }

    // resolution map: customerId → item[] (date is fixed, no date key needed)
    const resolutionMap = new Map<string, ResolvedSheetItem[]>();
    for (const item of allSheetItems) {
      if (!resolutionMap.has(item.customerId)) resolutionMap.set(item.customerId, []);
      resolutionMap.get(item.customerId)!.push(item);
    }

    // ── Step 4: Batch-fetch CustomerDeliverySchedule for fallback resolution ─
    // Only needed for customers who have no DailySheetItem on the selected date.
    // We'll determine which customers need this after the first resolution pass.
    // Fetch all schedules for all resolved customers upfront (one query).
    type VanScheduleEntry = { vanId: string; van: { plateNumber: string } };
    const scheduleMap = new Map<string, VanScheduleEntry[]>(); // customerId → schedules

    if (resolvedCustomerIds.length > 0) {
      const schedules = await this.prisma.customerDeliverySchedule.findMany({
        where: { customerId: { in: resolvedCustomerIds } },
        select: { customerId: true, vanId: true, van: { select: { plateNumber: true } } },
      });
      for (const s of schedules) {
        if (!scheduleMap.has(s.customerId)) scheduleMap.set(s.customerId, []);
        scheduleMap.get(s.customerId)!.push({ vanId: s.vanId, van: s.van });
      }
    }

    // Batch-fetch open sheets for the selected date — used to validate van sheets
    // when routing ad-hoc rows.
    const openSheetsForDate = await this.prisma.dailySheet.findMany({
      where: { vendorId, isClosed: false, date: { gte: startOfDay, lte: endOfDay } },
      select: { id: true, vanId: true, van: { select: { plateNumber: true } } },
    });
    const openSheetByVanId = new Map(openSheetsForDate.map((s) => [s.vanId, s]));

    // ── Step 5: Per-row resolution ────────────────────────────────────────────
    type RowResolutionKind = 'scheduled' | 'adhoc-auto' | 'adhoc-ambiguous' | 'closed' | 'error';

    interface RowResolution {
      row: RawGlobalRow;
      kind: RowResolutionKind;
      itemId: string | null;
      resolvedItem: ResolvedSheetItem | null;
      customerId: string | null;
      sheetId: string | null;
      vanPlateNumber: string;
      isClosed: boolean;
      sheetFound: boolean;
      rowErrors: string[];
      availableVans?: Array<{ vanId: string; plateNumber: string }>;
    }

    const resolutions: RowResolution[] = [];

    for (const row of rawRows) {
      const customerId = codeToCustomerId.get(row.customerCode);
      if (!customerId) {
        resolutions.push({
          row, kind: 'error', itemId: null, resolvedItem: null, customerId: null,
          sheetId: null, vanPlateNumber: '', isClosed: false, sheetFound: false,
          rowErrors: [`Customer with code "${row.customerCode}" not found.`],
        });
        continue;
      }

      const items = resolutionMap.get(customerId) ?? [];
      const openItems = items.filter((i) => !i.dailySheet.isClosed);
      const closedItems = items.filter((i) => i.dailySheet.isClosed);

      // ── Case A: Sheet is closed ───────────────────────────────────────────
      if (openItems.length === 0 && closedItems.length > 0) {
        const closed = closedItems[0];
        resolutions.push({
          row, kind: 'closed', itemId: null, resolvedItem: null, customerId,
          sheetId: closed.dailySheetId, vanPlateNumber: closed.dailySheet.van.plateNumber,
          isClosed: true, sheetFound: true, rowErrors: [],
        });
        continue;
      }

      // ── Case B: No scheduled item on this date → try schedule-based fallback
      if (openItems.length === 0) {
        const schedules = scheduleMap.get(customerId) ?? [];
        const uniqueVanIds = [...new Set(schedules.map((s) => s.vanId))];

        if (uniqueVanIds.length === 0) {
          resolutions.push({
            row, kind: 'error', itemId: null, resolvedItem: null, customerId,
            sheetId: null, vanPlateNumber: '', isClosed: false, sheetFound: false,
            rowErrors: [
              `Customer "${row.customerCode}" has no delivery schedule configured and no open sheet on ${dateStr}.`,
            ],
          });
          continue;
        }

        if (uniqueVanIds.length === 1) {
          // Single van — auto-resolve ad-hoc
          const vanId = uniqueVanIds[0];
          const openSheet = openSheetByVanId.get(vanId);
          if (!openSheet) {
            resolutions.push({
              row, kind: 'error', itemId: null, resolvedItem: null, customerId,
              sheetId: null, vanPlateNumber: schedules[0].van.plateNumber,
              isClosed: false, sheetFound: false,
              rowErrors: [
                `No open sheet for van "${schedules[0].van.plateNumber}" on ${dateStr}. Generate the sheet first.`,
              ],
            });
          } else {
            resolutions.push({
              row, kind: 'adhoc-auto', itemId: null, resolvedItem: null, customerId,
              sheetId: openSheet.id, vanPlateNumber: openSheet.van.plateNumber,
              isClosed: false, sheetFound: true, rowErrors: [],
            });
          }
          continue;
        }

        // Multiple vans — ambiguous, needs user selection
        resolutions.push({
          row, kind: 'adhoc-ambiguous', itemId: null, resolvedItem: null, customerId,
          sheetId: null, vanPlateNumber: '', isClosed: false, sheetFound: false,
          rowErrors: [],
          availableVans: schedules
            .filter((s, i, arr) => arr.findIndex((x) => x.vanId === s.vanId) === i)
            .map((s) => ({ vanId: s.vanId, plateNumber: s.van.plateNumber })),
        });
        continue;
      }

      // ── Case C: Multiple open sheets (shouldn't happen normally) ─────────
      const uniqueSheetIds = [...new Set(openItems.map((i) => i.dailySheetId))];
      if (uniqueSheetIds.length > 1) {
        resolutions.push({
          row, kind: 'error', itemId: null, resolvedItem: null, customerId,
          sheetId: null, vanPlateNumber: '', isClosed: false, sheetFound: false,
          rowErrors: [
            `Customer "${row.customerCode}" appears on multiple open sheets on ${dateStr}. Cannot auto-resolve — edit manually.`,
          ],
        });
        continue;
      }

      // ── Case D: Multiple items on same sheet (multiple products) ─────────
      const sheetId = uniqueSheetIds[0];
      const itemsOnSheet = openItems.filter((i) => i.dailySheetId === sheetId);
      if (itemsOnSheet.length > 1) {
        resolutions.push({
          row, kind: 'error', itemId: null, resolvedItem: null, customerId,
          sheetId, vanPlateNumber: openItems[0].dailySheet.van.plateNumber,
          isClosed: false, sheetFound: true,
          rowErrors: [
            `Customer "${row.customerCode}" has ${itemsOnSheet.length} delivery items on this sheet ` +
              `(multiple products). Cannot resolve without a Product column.`,
          ],
        });
        continue;
      }

      // ── Case E: ✅ Normal scheduled resolution ───────────────────────────
      const resolved = itemsOnSheet[0];
      resolutions.push({
        row, kind: 'scheduled', itemId: resolved.id, resolvedItem: resolved, customerId,
        sheetId, vanPlateNumber: resolved.dailySheet.van.plateNumber,
        isClosed: false, sheetFound: true, rowErrors: [],
      });
    }

    // ── Step 6: Separate ambiguous rows (go to top-level, not into groups) ──
    const ambiguousRows: AmbiguousPreviewRow[] = resolutions
      .filter((r) => r.kind === 'adhoc-ambiguous')
      .map((r) => ({
        rowIndex: r.row.rowIndex,
        customerId: r.customerId!,
        customerCode: r.row.customerCode,
        customerName: r.row.customerName,
        importStatus: r.row.status,
        filledDropped: r.row.filledDropped,
        emptyReturned: r.row.emptyReturned,
        cashCollected: r.row.cashCollected,
        failureReason: r.row.failureReason,
        warnings: r.row.sanitizationWarnings,
        availableVans: r.availableVans!,
      }));

    // ── Step 7: Group non-ambiguous rows by sheetId ───────────────────────
    const groupMap = new Map<string, RowResolution[]>();
    for (const res of resolutions) {
      if (res.kind === 'adhoc-ambiguous') continue; // handled separately
      const gKey = res.sheetId ?? 'UNRESOLVED';
      if (!groupMap.has(gKey)) groupMap.set(gKey, []);
      groupMap.get(gKey)!.push(res);
    }

    // ── Step 8: Build GlobalPreviewGroup[] ───────────────────────────────────
    const groups: GlobalPreviewGroup[] = [];
    let totalValid = 0;
    let totalAdhoc = 0;
    let totalInvalid = 0;
    let blockedGroupCount = 0;

    for (const [gKey, gResolutions] of groupMap) {
      const firstRes = gResolutions[0];
      const vanPlateNumber = firstRes.vanPlateNumber || '—';
      const sheetId = firstRes.sheetId;
      const sheetFound = gKey !== 'UNRESOLVED' && gResolutions.some((r) => r.sheetFound);
      const isClosed = gResolutions.some((r) => r.isClosed);
      const isGroupBlocked = !sheetFound || isClosed;

      if (isGroupBlocked) {
        const blockReason = isClosed
          ? `The daily sheet for van "${vanPlateNumber}" on ${dateStr} is closed.`
          : firstRes.rowErrors[0] ?? 'Could not match rows to an open daily sheet.';

        const invalidRows: PreviewRowResult[] = gResolutions.map((res) => ({
          rowIndex: res.row.rowIndex,
          itemId: null,
          customerName: res.row.customerName,
          customerCode: res.row.customerCode,
          productName: res.resolvedItem?.product.name ?? '',
          currentDbStatus: 'UNKNOWN',
          importStatus: res.row.status,
          filledDropped: res.row.filledDropped,
          emptyReturned: res.row.emptyReturned,
          cashCollected: res.row.cashCollected,
          failureReason: res.row.failureReason,
          errors: res.rowErrors.length > 0 ? res.rowErrors : [blockReason],
          warnings: res.row.sanitizationWarnings,
        }));

        groups.push({
          date: dateStr, vanPlateNumber, sheetId, sheetFound, isClosed, blockReason,
          valid: [], adhoc: [], invalid: invalidRows,
        });
        totalInvalid += invalidRows.length;
        blockedGroupCount++;
        continue;
      }

      const valid: PreviewRowResult[] = [];
      const adhoc: AdhocPreviewRow[] = [];
      const invalid: PreviewRowResult[] = [];

      for (const res of gResolutions) {
        if (res.kind === 'adhoc-auto') {
          adhoc.push({
            rowIndex: res.row.rowIndex,
            customerId: res.customerId!,
            customerCode: res.row.customerCode,
            customerName: res.row.customerName,
            importStatus: res.row.status,
            filledDropped: res.row.filledDropped,
            emptyReturned: res.row.emptyReturned,
            cashCollected: res.row.cashCollected,
            failureReason: res.row.failureReason,
            warnings: res.row.sanitizationWarnings,
          });
          continue;
        }

        if (res.rowErrors.length > 0 || !res.resolvedItem) {
          invalid.push({
            rowIndex: res.row.rowIndex,
            itemId: null,
            customerName: res.row.customerName,
            customerCode: res.row.customerCode,
            productName: '',
            currentDbStatus: 'UNKNOWN',
            importStatus: res.row.status,
            filledDropped: res.row.filledDropped,
            emptyReturned: res.row.emptyReturned,
            cashCollected: res.row.cashCollected,
            failureReason: res.row.failureReason,
            errors: res.rowErrors,
            warnings: res.row.sanitizationWarnings,
          });
          continue;
        }

        const sanitized: SanitizedSheetRow = {
          itemId: res.itemId!,
          customerCode: res.row.customerCode,
          customerName: res.row.customerName,
          productName: res.resolvedItem.product.name,
          status: res.row.status,
          filledDropped: res.row.filledDropped,
          emptyReturned: res.row.emptyReturned,
          cashCollected: res.row.cashCollected,
          failureReason: res.row.failureReason,
          sanitizationWarnings: res.row.sanitizationWarnings,
        };

        const result = this.buildPreviewRowResult(
          res.row.rowIndex,
          sanitized,
          res.itemId,
          res.resolvedItem as SheetItemForPreview,
          [],
        );

        if (result.errors.length > 0) invalid.push(result);
        else valid.push(result);
      }

      totalValid += valid.length;
      totalAdhoc += adhoc.length;
      totalInvalid += invalid.length;

      groups.push({
        date: dateStr, vanPlateNumber, sheetId: sheetId!, sheetFound: true, isClosed: false,
        valid, adhoc, invalid,
      });
    }

    return {
      groups,
      ambiguous: ambiguousRows,
      summary: {
        totalRows: totalValid + totalAdhoc + totalInvalid + ambiguousRows.length,
        validRows: totalValid,
        adhocRows: totalAdhoc,
        invalidRows: totalInvalid,
        blockedGroups: blockedGroupCount,
        ambiguousRows: ambiguousRows.length,
      },
    };
  }

  // ── Phase 2: Confirm ─────────────────────────────────────────────────────

  async confirmSheetImport(
    sheetId: string,
    vendorId: string,
    dto: BulkImportConfirmDto,
  ): Promise<SheetImportConfirmResponse> {
    const sheet = await this.prisma.dailySheet.findFirst({
      where: { id: sheetId, vendorId },
      select: { id: true, date: true, vendorId: true, isClosed: true },
    });
    if (!sheet) throw new NotFoundException('Daily sheet not found');
    if (sheet.isClosed) {
      throw new ConflictException(
        'Sheet was closed after your preview was loaded. Import rejected.',
      );
    }

    const itemIds = dto.rows.map((r) => r.itemId);
    const dbItems = await this.prisma.dailySheetItem.findMany({
      where: { id: { in: itemIds }, dailySheetId: sheetId },
      select: {
        id: true,
        customerId: true,
        productId: true,
        status: true,
        customer: {
          select: {
            customerCode: true,
            name: true,
            isBillingExempt: true,
            customPrices: { select: { productId: true, customPrice: true } },
          },
        },
        product: { select: { name: true, basePrice: true } },
      },
    }) as SheetItemForPreview[];

    if (dbItems.length !== itemIds.length) {
      throw new BadRequestException(
        'One or more item IDs could not be verified against this sheet. Re-upload the template.',
      );
    }

    await this.prisma.$transaction(
      async (tx) => {
        for (const row of dto.rows) {
          await this.applyImportRow(tx, row, sheet, dbItems, vendorId);
        }
      },
      { timeout: 30000, maxWait: 5000 },
    );

    await this.audit.log({
      vendorId,
      action: 'BULK_IMPORT_CONFIRMED',
      entity: 'DailySheet',
      entityId: sheetId,
      changes: { after: { processedRows: dto.rows.length } },
    });

    return { sheetId, processed: dto.rows.length, errors: [] };
  }

  private async createAndApplyAdhocRow(
    tx: Prisma.TransactionClient,
    row: AdhocImportRowDto,
    sheet: { id: string; date: Date; vendorId: string },
    defaultProductId: string,
    vendorId: string,
  ): Promise<void> {
    const customer = await tx.customer.findFirst({
      where: { id: row.customerId, vendorId },
      select: {
        isBillingExempt: true,
        customPrices: { select: { productId: true, customPrice: true } },
      },
    });
    if (!customer) throw new BadRequestException(`Customer ${row.customerId} not found`);

    const product = await tx.product.findFirst({
      where: { id: defaultProductId, vendorId },
      select: { basePrice: true },
    });
    if (!product) throw new BadRequestException('Default product not found');

    const customPrice = customer.customPrices.find((p) => p.productId === defaultProductId);
    const price = customer.isBillingExempt ? 0 : (customPrice?.customPrice ?? product.basePrice);

    const resolvedStatus =
      row.status === 'COMPLETED' && row.filledDropped === 0 ? 'EMPTY_ONLY' : row.status;
    const isDelivered = resolvedStatus === 'COMPLETED' || resolvedStatus === 'EMPTY_ONLY';

    const lastItem = await tx.dailySheetItem.findFirst({
      where: { dailySheetId: sheet.id },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    });
    const nextSequence = (lastItem?.sequence ?? 0) + 1;

    const newItem = await tx.dailySheetItem.create({
      data: {
        dailySheetId: sheet.id,
        customerId: row.customerId,
        productId: defaultProductId,
        sequence: nextSequence,
        deliveryType: 'ON_DEMAND',
        status: resolvedStatus as any,
        filledDropped: row.filledDropped,
        emptyReceived: row.emptyReturned,
        cashCollected: row.cashCollected,
        pricePerBottle: price,
        reason: row.failureReason ?? null,
        deliveredAt: isDelivered ? sheet.date : null,
      },
    });

    if (isDelivered) {
      await this.ledger.recordDelivery(
        {
          vendorId,
          customerId: row.customerId,
          productId: defaultProductId,
          dailySheetId: sheet.id,
          dailySheetItemId: newItem.id,
          filledDropped: row.filledDropped,
          emptyReceived: row.emptyReturned,
          cashCollected: row.cashCollected,
          pricePerBottle: price,
        },
        tx,
      );
    }
  }

  async confirmGlobalImport(
    vendorId: string,
    dto: GlobalImportConfirmDto,
  ): Promise<GlobalImportConfirmResponse> {
    const results: Array<{
      sheetId: string;
      date: string;
      vanPlateNumber: string;
      success: boolean;
      processed: number;
      error?: string;
    }> = [];
    let totalProcessed = 0;
    let failedGroups = 0;

    for (const group of dto.groups) {
      const sheet = await this.prisma.dailySheet.findFirst({
        where: { id: group.sheetId, vendorId },
        select: {
          id: true,
          date: true,
          vendorId: true,
          isClosed: true,
          van: { select: { plateNumber: true } },
        },
      });

      const dateStr = sheet?.date.toISOString().slice(0, 10) ?? '';
      const plateNumber = sheet?.van?.plateNumber ?? '';

      if (!sheet) {
        results.push({ sheetId: group.sheetId, date: dateStr, vanPlateNumber: plateNumber, success: false, processed: 0, error: 'Sheet not found' });
        failedGroups++;
        continue;
      }

      if (sheet.isClosed) {
        results.push({ sheetId: group.sheetId, date: dateStr, vanPlateNumber: plateNumber, success: false, processed: 0, error: 'Sheet was closed after preview.' });
        failedGroups++;
        continue;
      }

      const itemIds = group.rows.map((r) => r.itemId);
      const dbItems = await this.prisma.dailySheetItem.findMany({
        where: { id: { in: itemIds }, dailySheetId: group.sheetId },
        select: {
          id: true,
          customerId: true,
          productId: true,
          status: true,
          customer: {
            select: {
              customerCode: true,
              name: true,
              isBillingExempt: true,
              customPrices: { select: { productId: true, customPrice: true } },
            },
          },
          product: { select: { name: true, basePrice: true } },
        },
      }) as SheetItemForPreview[];

      if (dbItems.length !== itemIds.length) {
        results.push({ sheetId: group.sheetId, date: dateStr, vanPlateNumber: plateNumber, success: false, processed: 0, error: 'One or more item IDs could not be verified. Re-upload the global template.' });
        failedGroups++;
        continue;
      }

      // Fetch default product once per vendor (needed for ad-hoc item creation)
      const defaultProduct = group.adhocRows.length > 0
        ? await this.prisma.product.findFirst({ where: { vendorId, isActive: true }, select: { id: true } })
        : null;

      if (group.adhocRows.length > 0 && !defaultProduct) {
        results.push({ sheetId: group.sheetId, date: dateStr, vanPlateNumber: plateNumber, success: false, processed: 0, error: 'No active product found — cannot create ad-hoc delivery items.' });
        failedGroups++;
        continue;
      }

      const processedCount = group.rows.length + group.adhocRows.length;

      try {
        await this.prisma.$transaction(
          async (tx) => {
            for (const row of group.rows) {
              await this.applyImportRow(tx, row, sheet, dbItems, vendorId);
            }
            for (const adhocRow of group.adhocRows) {
              await this.createAndApplyAdhocRow(tx, adhocRow, sheet, defaultProduct!.id, vendorId);
            }
          },
          { timeout: 30000, maxWait: 5000 },
        );

        await this.audit.log({
          vendorId,
          action: 'GLOBAL_BULK_IMPORT_GROUP_CONFIRMED',
          entity: 'DailySheet',
          entityId: group.sheetId,
          changes: { after: { processedRows: processedCount, adhocCreated: group.adhocRows.length } },
        });

        results.push({ sheetId: group.sheetId, date: dateStr, vanPlateNumber: plateNumber, success: true, processed: processedCount });
        totalProcessed += processedCount;
      } catch (err) {
        results.push({ sheetId: group.sheetId, date: dateStr, vanPlateNumber: plateNumber, success: false, processed: 0, error: err instanceof Error ? err.message : 'Transaction failed' });
        failedGroups++;
      }
    }

    return { results, totalProcessed, failedGroups };
  }
}
