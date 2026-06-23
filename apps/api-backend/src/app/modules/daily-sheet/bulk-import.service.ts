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
import { GlobalImportConfirmDto } from './dto/global-import-confirm.dto';
import {
  SanitizedSheetRow,
  SanitizedGlobalRow,
  PreviewRowResult,
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
      { header: 'DeliveryDate', key: 'deliveryDate', width: 15 },
      { header: 'VanPlateNumber', key: 'vanPlateNumber', width: 16 },
      { header: 'CustomerCode', key: 'customerCode', width: 14 },
      { header: 'Product', key: 'product', width: 18 },
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
      deliveryDate: 'YYYY-MM-DD',
      vanPlateNumber: 'VAN-PLATE',
      customerCode: 'C-0001',
      product: 'Product Name',
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
    file: Express.Multer.File,
  ): Promise<GlobalImportPreviewResponse> {
    const workbook = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(file.buffer as any);
    const ws = workbook.getWorksheet(1);
    if (!ws) throw new BadRequestException('No worksheet found in the uploaded file');

    const REQUIRED = [
      'DeliveryDate', 'VanPlateNumber', 'CustomerCode', 'Product',
      'Status', 'FilledDropped', 'EmptyReturned', 'CashCollected',
    ];
    const colIndex = this.resolveColumnIndex(ws.getRow(1), REQUIRED, ['CustomerName', 'FailureReason']);

    const groupMap = new Map<string, SanitizedGlobalRowWithIndex[]>();

    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return;

      const rawDate = this.sanitizeCellValue(row.getCell(colIndex['DeliveryDate']).value);
      const rawVan = this.sanitizeCellValue(row.getCell(colIndex['VanPlateNumber']).value).toUpperCase();

      if (!rawDate && !rawVan) return;

      const fResult = this.parseNonNegativeInt(row.getCell(colIndex['FilledDropped']).value);
      const eResult = this.parseNonNegativeInt(row.getCell(colIndex['EmptyReturned']).value);
      const cResult = this.parseNonNegativeDecimal(row.getCell(colIndex['CashCollected']).value);

      const sanitized: SanitizedGlobalRowWithIndex = {
        rowIndex: rowNum,
        deliveryDate: rawDate,
        vanPlateNumber: rawVan,
        itemId: '',
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

      const groupKey = `${rawDate}::${rawVan}`;
      if (!groupMap.has(groupKey)) groupMap.set(groupKey, []);
      groupMap.get(groupKey)!.push(sanitized);
    });

    const groups: GlobalPreviewGroup[] = [];
    let totalValid = 0;
    let totalInvalid = 0;
    let blockedGroups = 0;

    for (const [groupKey, rows] of groupMap) {
      const separatorIdx = groupKey.indexOf('::');
      const date = groupKey.slice(0, separatorIdx);
      const vanPlateNumber = groupKey.slice(separatorIdx + 2);

      const dateObj = new Date(date);
      if (isNaN(dateObj.getTime())) {
        const invalidRows: PreviewRowResult[] = rows.map((r) => ({
          rowIndex: r.rowIndex,
          itemId: null,
          customerName: r.customerName,
          customerCode: r.customerCode,
          productName: r.productName,
          currentDbStatus: 'UNKNOWN',
          importStatus: r.status,
          filledDropped: r.filledDropped,
          emptyReturned: r.emptyReturned,
          cashCollected: r.cashCollected,
          failureReason: r.failureReason,
          errors: [`Invalid date format "${date}". Use YYYY-MM-DD.`],
          warnings: [],
        }));
        groups.push({
          date, vanPlateNumber, sheetId: null, sheetFound: false, isClosed: false,
          blockReason: `Invalid date format "${date}". Use YYYY-MM-DD.`,
          valid: [], invalid: invalidRows,
        });
        totalInvalid += rows.length;
        blockedGroups++;
        continue;
      }

      const van = await this.prisma.van.findFirst({
        where: { plateNumber: vanPlateNumber, vendorId },
        select: { id: true },
      });

      if (!van) {
        const invalidRows: PreviewRowResult[] = rows.map((r) => ({
          rowIndex: r.rowIndex,
          itemId: null,
          customerName: r.customerName,
          customerCode: r.customerCode,
          productName: r.productName,
          currentDbStatus: 'UNKNOWN',
          importStatus: r.status,
          filledDropped: r.filledDropped,
          emptyReturned: r.emptyReturned,
          cashCollected: r.cashCollected,
          failureReason: r.failureReason,
          errors: [`Van with plate number "${vanPlateNumber}" not found.`],
          warnings: [],
        }));
        groups.push({
          date, vanPlateNumber, sheetId: null, sheetFound: false, isClosed: false,
          blockReason: `Van with plate number "${vanPlateNumber}" not found.`,
          valid: [], invalid: invalidRows,
        });
        totalInvalid += rows.length;
        blockedGroups++;
        continue;
      }

      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const sheet = await this.prisma.dailySheet.findFirst({
        where: { vanId: van.id, vendorId, date: { gte: startOfDay, lte: endOfDay } },
        select: { id: true, isClosed: true },
      });

      if (!sheet) {
        groups.push({
          date, vanPlateNumber, sheetId: null, sheetFound: false, isClosed: false,
          blockReason: `No daily sheet exists for van "${vanPlateNumber}" on ${date}. Generate the sheet first.`,
          valid: [], invalid: [],
        });
        blockedGroups++;
        continue;
      }

      if (sheet.isClosed) {
        groups.push({
          date, vanPlateNumber, sheetId: sheet.id, sheetFound: true, isClosed: true,
          blockReason: `The daily sheet for van "${vanPlateNumber}" on ${date} is closed.`,
          valid: [], invalid: [],
        });
        blockedGroups++;
        continue;
      }

      const dbItems = await this.fetchSheetItemsForPreview(sheet.id);
      const fallbackMap = this.buildFallbackMap(dbItems);
      const dbItemMap = new Map(dbItems.map((i) => [i.id, i]));

      const valid: PreviewRowResult[] = [];
      const invalid: PreviewRowResult[] = [];

      for (const row of rows) {
        const resolvedItemId = this.resolveItemId('', row.customerCode, row.productName, fallbackMap);
        const dbItem = resolvedItemId ? dbItemMap.get(resolvedItemId) : undefined;
        const itemErrors: string[] = [];

        if (!resolvedItemId) {
          itemErrors.push(
            `Could not identify customer "${row.customerCode}" / product "${row.productName}" ` +
              `in the sheet for ${vanPlateNumber} on ${date}.`,
          );
        }

        const result = this.buildPreviewRowResult(row.rowIndex, row, resolvedItemId ?? null, dbItem, itemErrors);

        if (result.errors.length > 0) invalid.push(result);
        else valid.push(result);
      }

      totalValid += valid.length;
      totalInvalid += invalid.length;

      groups.push({
        date, vanPlateNumber, sheetId: sheet.id, sheetFound: true, isClosed: false,
        valid, invalid,
      });
    }

    return {
      groups,
      summary: {
        totalRows: totalValid + totalInvalid,
        validRows: totalValid,
        invalidRows: totalInvalid,
        blockedGroups,
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

      try {
        await this.prisma.$transaction(
          async (tx) => {
            for (const row of group.rows) {
              await this.applyImportRow(tx, row, sheet, dbItems, vendorId);
            }
          },
          { timeout: 30000, maxWait: 5000 },
        );

        await this.audit.log({
          vendorId,
          action: 'GLOBAL_BULK_IMPORT_GROUP_CONFIRMED',
          entity: 'DailySheet',
          entityId: group.sheetId,
          changes: { after: { processedRows: group.rows.length } },
        });

        results.push({ sheetId: group.sheetId, date: dateStr, vanPlateNumber: plateNumber, success: true, processed: group.rows.length });
        totalProcessed += group.rows.length;
      } catch (err) {
        results.push({ sheetId: group.sheetId, date: dateStr, vanPlateNumber: plateNumber, success: false, processed: 0, error: err instanceof Error ? err.message : 'Transaction failed' });
        failedGroups++;
      }
    }

    return { results, totalProcessed, failedGroups };
  }
}
