import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { ExpenseCategory, Prisma } from '@prisma/client';
import { paginate } from '../../common/helpers/paginate';
import type { AuthUser } from '@water-supply-crm/types';
import { AuditService } from '../audit/audit.service';
import { VanCashLedgerService } from '../van-cash-ledger/van-cash-ledger.service';
import { SHEET_CASH_RELOAD_INCLUDE, resolveSheetCash } from '../daily-sheet/sheet-cash.util';
import { VehicleServiceTypeService } from './vehicle-service-type.service';
import { UpdateMaintenanceRuleDto } from './dto/update-maintenance-rule.dto';
import { CreateServiceRecordDto } from './dto/create-service-record.dto';
import { UpdateServiceRecordDto } from './dto/update-service-record.dto';
import { ServiceRecordQueryDto } from './dto/service-record-query.dto';
import { dayRange } from './fleet-period.util';
import { computeMaintenanceStatus } from './fleet-maintenance.util';

const serviceRecordInclude = {
  recordedBy: { select: { id: true, name: true } },
  vehicle: { select: { id: true, plateNumber: true } },
  // The payment flag lives on the linked Expense — surfaced so the edit form can prefill it.
  expense: { select: { paidFromCash: true, dailySheetId: true } },
};

/**
 * §17 Amendment (2026-08-21): re-keyed from `vanId` to `vehicleId` — service
 * intervals/history are truck-specific (engine wear, not route history), see
 * §17.1.
 */
@Injectable()
export class VehicleMaintenanceService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private serviceTypes: VehicleServiceTypeService,
    private vanCashLedger: VanCashLedgerService,
    private cache: CacheInvalidationService,
  ) {}

  /**
   * A sheet-linked service Expense (paidFromCash) feeds the sheet's hand-in, so on
   * a CLOSED sheet any create / edit / delete of it must flag the sheet as modified
   * after close and re-sync the Cash Ledger — same as ExpenseService's closed-sheet
   * corrections (which refuse service-record expenses, hence handled here).
   */
  private async markClosedSheetCorrected(tx: Prisma.TransactionClient, vendorId: string, dailySheetId: string) {
    await tx.dailySheet.update({
      where: { id: dailySheetId },
      data: { postCloseExpenseCorrectionCount: { increment: 1 } },
    });
    const sheet = await tx.dailySheet.findUnique({ where: { id: dailySheetId }, include: SHEET_CASH_RELOAD_INCLUDE });
    if (!sheet) return;
    const resolved = resolveSheetCash(sheet as unknown as Record<string, unknown>);
    await this.vanCashLedger.handlePostCloseCorrection(tx, vendorId, dailySheetId, resolved.cashExpected);
  }

  private async invalidateSheetRollups(vendorId: string, sheetDate?: Date | null) {
    const dateStr = sheetDate ? new Date(sheetDate).toISOString().slice(0, 10) : undefined;
    await Promise.all([
      this.cache.invalidateDailyDashboard(vendorId, dateStr),
      this.cache.invalidateOverview(vendorId),
      this.cache.invalidateAnalytics(vendorId),
    ]);
  }

  /**
   * Makes sure a vehicle has a rule row for every service type in the vendor's
   * catalogue, seeded from each type's default intervals. Always per-vehicle
   * (no separate vendor-wide default row — see schema comment on
   * VehicleMaintenanceRule). Runs on every status read so a type added later
   * (or a vehicle added after it) picks up its rule without a backfill; rules
   * a user switched off (isActive=false) still exist, so they are never re-created.
   */
  async ensureDefaultRules(vendorId: string, vehicleId: string): Promise<void> {
    const [types, existing] = await Promise.all([
      this.serviceTypes.listDefs(vendorId),
      this.prisma.vehicleMaintenanceRule.findMany({ where: { vehicleId }, select: { serviceType: true } }),
    ]);
    const have = new Set(existing.map((r) => r.serviceType));
    const missing = types.filter((t) => !have.has(t.key));
    if (missing.length === 0) return;

    await this.prisma.vehicleMaintenanceRule.createMany({
      data: missing.map((t) => ({
        vendorId,
        vehicleId,
        serviceType: t.key,
        intervalKm: t.defaultIntervalKm,
        intervalDays: t.defaultIntervalDays,
      })),
      skipDuplicates: true,
    });
  }

  async getStatusForVehicle(vendorId: string, vehicleId: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, vendorId },
      include: { vehicleProfile: true },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');

    await this.ensureDefaultRules(vendorId, vehicleId);
    const labelOf = await this.serviceTypes.getLabelMap(vendorId);

    const rules = await this.prisma.vehicleMaintenanceRule.findMany({
      where: { vehicleId, isActive: true },
      orderBy: { serviceType: 'asc' },
    });

    const latestRecords = await this.prisma.vehicleServiceRecord.findMany({
      where: { vehicleId },
      distinct: ['serviceType'],
      orderBy: { performedAtDate: 'desc' },
    });
    const latestByType = new Map(latestRecords.map((r) => [r.serviceType, r]));

    const currentOdometer = vehicle.vehicleProfile?.currentOdometer ?? 0;
    const baselineDate = vehicle.vehicleProfile?.createdAt ?? vehicle.createdAt;

    return rules.map((rule) => {
      const last = latestByType.get(rule.serviceType);
      const computed = computeMaintenanceStatus({
        intervalKm: rule.intervalKm,
        intervalDays: rule.intervalDays,
        lastServiceOdometer: last?.performedAtOdometer ?? null,
        lastServiceDate: last?.performedAtDate ?? null,
        currentOdometer,
        baselineDate,
      });

      return {
        ruleId: rule.id,
        vehicleId,
        serviceType: rule.serviceType,
        label: labelOf(rule.serviceType),
        intervalKm: rule.intervalKm,
        intervalDays: rule.intervalDays,
        lastServiceOdometer: last?.performedAtOdometer ?? null,
        lastServiceDate: last?.performedAtDate ?? null,
        ...computed,
      };
    });
  }

  /** Fleet-wide rollup for the dashboard — total overdue/due counts across every vehicle. */
  async getFleetWideStatus(vendorId: string) {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { vendorId, isActive: true },
      select: { id: true, plateNumber: true },
    });

    const results = await Promise.all(
      vehicles.map(async (vehicle) => {
        const statuses = await this.getStatusForVehicle(vendorId, vehicle.id);
        return {
          vehicleId: vehicle.id,
          plateNumber: vehicle.plateNumber,
          overdueCount: statuses.filter((s) => s.urgency === 'OVERDUE').length,
          dueCount: statuses.filter((s) => s.urgency === 'DUE').length,
        };
      }),
    );

    return {
      vehicles: results,
      totalOverdue: results.reduce((sum, r) => sum + r.overdueCount, 0),
      totalDue: results.reduce((sum, r) => sum + r.dueCount, 0),
    };
  }

  async updateRule(user: AuthUser, id: string, dto: UpdateMaintenanceRuleDto) {
    const rule = await this.prisma.vehicleMaintenanceRule.findFirst({ where: { id, vendorId: user.vendorId } });
    if (!rule) throw new NotFoundException('Maintenance rule not found');

    const updated = await this.prisma.vehicleMaintenanceRule.update({
      where: { id },
      data: {
        ...(dto.intervalKm !== undefined && { intervalKm: dto.intervalKm }),
        ...(dto.intervalDays !== undefined && { intervalDays: dto.intervalDays }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'UPDATED',
      entity: 'VehicleMaintenanceRule',
      entityId: id,
      changes: { before: rule, after: updated },
    });

    return updated;
  }

  async createServiceRecord(user: AuthUser, dto: CreateServiceRecordDto) {
    const vehicle = await this.prisma.vehicle.findFirst({ where: { id: dto.vehicleId, vendorId: user.vendorId } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    const serviceLabel = await this.serviceTypes.assertKeyExists(user.vendorId, dto.serviceType);

    // Added from a Daily Sheet → pin the Expense to it (and to the trip in
    // progress / last trip, like fuel) so cash-paid service reduces the hand-in.
    let sheet: { id: string; vanId: string | null; isClosed: boolean; date: Date } | null = null;
    let dailySheetLoadId: string | null = null;
    if (dto.dailySheetId) {
      sheet = await this.prisma.dailySheet.findFirst({
        where: { id: dto.dailySheetId, vendorId: user.vendorId },
        select: { id: true, vanId: true, isClosed: true, date: true },
      });
      if (!sheet) throw new NotFoundException('Daily sheet not found');
      const load = await this.prisma.dailySheetLoad.findFirst({
        where: sheet.isClosed
          ? { dailySheetId: sheet.id, endedAt: { not: null } }
          : { dailySheetId: sheet.id, endedAt: null },
        orderBy: { endedAt: 'desc' },
        select: { id: true },
      });
      dailySheetLoadId = load?.id ?? null;
    }

    const record = await this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          vendorId: user.vendorId,
          category: ExpenseCategory.VEHICLE_MAINTENANCE,
          amount: dto.cost,
          paidFromCash: dto.paidFromCash ?? true,
          description: `${serviceLabel} — ${vehicle.plateNumber}`,
          date: new Date(dto.performedAtDate),
          // Without a sheet the Expense stays route-level (§17.2) — this vehicle
          // isn't necessarily tied to a specific van/route at service time, so no
          // vanId is attached. With a sheet it takes that sheet's van.
          vanId: sheet?.vanId ?? null,
          dailySheetId: sheet?.id ?? null,
          dailySheetLoadId,
          createdById: user.userId,
        },
      });

      if (sheet?.isClosed) await this.markClosedSheetCorrected(tx, user.vendorId, sheet.id);

      return tx.vehicleServiceRecord.create({
        data: {
          vendorId: user.vendorId,
          vehicleId: dto.vehicleId,
          serviceType: dto.serviceType,
          performedAtOdometer: dto.performedAtOdometer,
          performedAtDate: new Date(dto.performedAtDate),
          cost: dto.cost,
          workshopName: dto.workshopName ?? null,
          invoicePhotoKey: dto.invoicePhotoKey ?? null,
          partsReplaced: dto.partsReplaced ?? null,
          notes: dto.notes ?? null,
          expenseId: expense.id,
          recordedById: user.userId,
        },
        include: serviceRecordInclude,
      });
    });

    if (sheet) await this.invalidateSheetRollups(user.vendorId, sheet.date);

    // Keep the profile's odometer cache current if this service happened
    // further than any check has reported yet (workshop odometer is authoritative
    // for that moment — e.g. a check was skipped that day).
    const currentProfile = await this.prisma.vehicleProfile.findUnique({ where: { vehicleId: dto.vehicleId } });
    const nextOdometer = Math.max(dto.performedAtOdometer, currentProfile?.currentOdometer ?? 0);
    await this.prisma.vehicleProfile.upsert({
      where: { vehicleId: dto.vehicleId },
      create: { vendorId: user.vendorId, vehicleId: dto.vehicleId, currentOdometer: nextOdometer },
      update: { currentOdometer: nextOdometer },
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'CREATED',
      entity: 'VehicleServiceRecord',
      entityId: record.id,
      changes: { after: record },
    });

    return record;
  }

  async listServiceRecords(vendorId: string, query: ServiceRecordQueryDto) {
    const { page = 1, limit = 20, vehicleId, serviceType, dateFrom, dateTo } = query;
    const where: any = { vendorId };
    if (vehicleId) where.vehicleId = vehicleId;
    if (serviceType) where.serviceType = serviceType;
    const range = dayRange(dateFrom, dateTo);
    if (range) where.performedAtDate = { gte: range.from, lt: range.to };

    const [data, total, agg] = await Promise.all([
      this.prisma.vehicleServiceRecord.findMany({
        where,
        include: serviceRecordInclude,
        orderBy: { performedAtDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.vehicleServiceRecord.count({ where }),
      this.prisma.vehicleServiceRecord.aggregate({ where, _sum: { cost: true } }),
    ]);

    return { ...paginate(data, total, page, limit), summary: { count: total, totalCost: agg._sum.cost ?? 0 } };
  }

  async getServiceRecord(vendorId: string, id: string) {
    const record = await this.prisma.vehicleServiceRecord.findFirst({
      where: { id, vendorId },
      include: serviceRecordInclude,
    });
    if (!record) throw new NotFoundException('Service record not found');
    return record;
  }

  async updateServiceRecord(user: AuthUser, id: string, dto: UpdateServiceRecordDto) {
    const record = await this.prisma.vehicleServiceRecord.findFirst({
      where: { id, vendorId: user.vendorId },
      include: {
        vehicle: { select: { id: true, plateNumber: true } },
        expense: { select: { dailySheetId: true, dailySheet: { select: { isClosed: true, date: true } } } },
      },
    });
    if (!record) throw new NotFoundException('Service record not found');
    const linkedClosedSheetId = record.expense?.dailySheet?.isClosed ? record.expense.dailySheetId : null;
    const serviceLabel =
      dto.serviceType !== undefined ? await this.serviceTypes.assertKeyExists(user.vendorId, dto.serviceType) : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (
        record.expenseId &&
        (dto.cost !== undefined ||
          dto.performedAtDate !== undefined ||
          dto.serviceType !== undefined ||
          dto.paidFromCash !== undefined)
      ) {
        await tx.expense.update({
          where: { id: record.expenseId },
          data: {
            ...(dto.cost !== undefined && { amount: dto.cost }),
            ...(dto.paidFromCash !== undefined && { paidFromCash: dto.paidFromCash }),
            ...(dto.performedAtDate !== undefined && { date: new Date(dto.performedAtDate) }),
            ...(dto.serviceType !== undefined && {
              description: `${serviceLabel} — ${record.vehicle.plateNumber}`,
            }),
          },
        });
        if (linkedClosedSheetId) await this.markClosedSheetCorrected(tx, user.vendorId, linkedClosedSheetId);
      }

      return tx.vehicleServiceRecord.update({
        where: { id },
        data: {
          ...(dto.serviceType !== undefined && { serviceType: dto.serviceType }),
          ...(dto.performedAtOdometer !== undefined && { performedAtOdometer: dto.performedAtOdometer }),
          ...(dto.performedAtDate !== undefined && { performedAtDate: new Date(dto.performedAtDate) }),
          ...(dto.cost !== undefined && { cost: dto.cost }),
          ...(dto.workshopName !== undefined && { workshopName: dto.workshopName }),
          ...(dto.invoicePhotoKey !== undefined && { invoicePhotoKey: dto.invoicePhotoKey }),
          ...(dto.partsReplaced !== undefined && { partsReplaced: dto.partsReplaced }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
        },
        include: serviceRecordInclude,
      });
    });

    if (linkedClosedSheetId) await this.invalidateSheetRollups(user.vendorId, record.expense?.dailySheet?.date);

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'UPDATED',
      entity: 'VehicleServiceRecord',
      entityId: id,
      changes: { before: record, after: updated },
    });

    return updated;
  }

  async removeServiceRecord(user: AuthUser, id: string) {
    const record = await this.prisma.vehicleServiceRecord.findFirst({
      where: { id, vendorId: user.vendorId },
      include: { expense: { select: { dailySheetId: true, dailySheet: { select: { isClosed: true, date: true } } } } },
    });
    if (!record) throw new NotFoundException('Service record not found');
    const linkedClosedSheetId = record.expense?.dailySheet?.isClosed ? record.expense.dailySheetId : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.vehicleServiceRecord.delete({ where: { id } });
      if (record.expenseId) {
        await tx.expense.delete({ where: { id: record.expenseId } });
        if (linkedClosedSheetId) await this.markClosedSheetCorrected(tx, user.vendorId, linkedClosedSheetId);
      }
    });
    if (linkedClosedSheetId) await this.invalidateSheetRollups(user.vendorId, record.expense?.dailySheet?.date);

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'DELETED',
      entity: 'VehicleServiceRecord',
      entityId: id,
      changes: { before: record },
    });

    return { deleted: true };
  }
}
