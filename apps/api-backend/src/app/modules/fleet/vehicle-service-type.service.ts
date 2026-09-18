import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { VEHICLE_MAINTENANCE_DEFAULT_INTERVALS, VEHICLE_SERVICE_TYPE_LABELS } from '@water-supply-crm/types';
import type { AuthUser, VehicleServiceTypeEntry } from '@water-supply-crm/types';
import { AuditService } from '../audit/audit.service';
import { CreateServiceTypeDto } from './dto/create-service-type.dto';
import { UpdateServiceTypeDto } from './dto/update-service-type.dto';

/** The undeletable fallback type — also guarantees a seeded vendor never has an empty catalogue. */
const SYSTEM_KEY = 'OTHER';
const BUILT_IN_KEYS = Object.keys(VEHICLE_SERVICE_TYPE_LABELS);
const MAX_KEY_LENGTH = 40;

/** "Clutch Plate (front)" -> "CLUTCH_PLATE_FRONT". Empty for labels with no latin letters/digits. */
export function slugifyServiceTypeKey(label: string): string {
  return label
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_KEY_LENGTH)
    .replace(/_+$/g, '');
}

/** Last-resort display label for a key that has no catalogue row: "CLUTCH_PLATE" -> "Clutch Plate". */
export function prettifyServiceTypeKey(key: string): string {
  return key
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Per-vendor catalogue behind the "Record Service" dropdown (replaces the old
 * VehicleServiceType enum). Records/rules store the type's `key` as a string
 * with no FK, so deletion safety lives here: a type can only be removed while
 * no service record uses it.
 */
@Injectable()
export class VehicleServiceTypeService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /**
   * Seeds the built-ins for a vendor that has no catalogue yet (vendors that
   * pre-date the migration were seeded by it). Safe to race: the unique
   * (vendorId, key) + skipDuplicates make a concurrent double-seed a no-op.
   * Never re-seeds after the fact — the undeletable OTHER row guarantees a
   * seeded vendor always has count > 0, so a deleted built-in stays deleted.
   */
  async ensureSeeded(vendorId: string): Promise<void> {
    const count = await this.prisma.vehicleServiceTypeDef.count({ where: { vendorId } });
    if (count > 0) return;

    await this.prisma.vehicleServiceTypeDef.createMany({
      data: BUILT_IN_KEYS.map((key) => ({
        vendorId,
        key,
        label: VEHICLE_SERVICE_TYPE_LABELS[key],
        defaultIntervalKm: VEHICLE_MAINTENANCE_DEFAULT_INTERVALS[key]?.intervalKm ?? null,
        defaultIntervalDays: VEHICLE_MAINTENANCE_DEFAULT_INTERVALS[key]?.intervalDays ?? null,
        isSystem: key === SYSTEM_KEY,
      })),
      skipDuplicates: true,
    });
  }

  /** Raw catalogue rows in display order (built-ins in their original order, custom A-Z, "Other" last). */
  async listDefs(vendorId: string) {
    await this.ensureSeeded(vendorId);
    const defs = await this.prisma.vehicleServiceTypeDef.findMany({ where: { vendorId } });

    const rank = (d: { key: string }) => (d.key === SYSTEM_KEY ? 2 : BUILT_IN_KEYS.includes(d.key) ? 0 : 1);
    return defs.sort((a, b) => {
      const byRank = rank(a) - rank(b);
      if (byRank !== 0) return byRank;
      if (rank(a) === 0) return BUILT_IN_KEYS.indexOf(a.key) - BUILT_IN_KEYS.indexOf(b.key);
      return a.label.localeCompare(b.label);
    });
  }

  async list(vendorId: string): Promise<VehicleServiceTypeEntry[]> {
    const defs = await this.listDefs(vendorId);
    const usage = await this.prisma.vehicleServiceRecord.groupBy({
      by: ['serviceType'],
      where: { vendorId },
      _count: { _all: true },
    });
    const usageByKey = new Map(usage.map((u) => [u.serviceType, u._count._all]));

    return defs.map((d) => ({
      id: d.id,
      key: d.key,
      label: d.label,
      defaultIntervalKm: d.defaultIntervalKm,
      defaultIntervalDays: d.defaultIntervalDays,
      isSystem: d.isSystem,
      usageCount: usageByKey.get(d.key) ?? 0,
    }));
  }

  /** key -> label for this vendor (falls back to a prettified key for orphans). */
  async getLabelMap(vendorId: string): Promise<(key: string) => string> {
    const defs = await this.listDefs(vendorId);
    const map = new Map(defs.map((d) => [d.key, d.label]));
    return (key) => map.get(key) ?? VEHICLE_SERVICE_TYPE_LABELS[key] ?? prettifyServiceTypeKey(key);
  }

  /** Throws 400 unless `key` is in this vendor's catalogue; returns its label. */
  async assertKeyExists(vendorId: string, key: string): Promise<string> {
    await this.ensureSeeded(vendorId);
    const def = await this.prisma.vehicleServiceTypeDef.findUnique({
      where: { vendorId_key: { vendorId, key } },
    });
    if (!def) throw new BadRequestException(`Unknown service type "${key}"`);
    return def.label;
  }

  async create(user: AuthUser, dto: CreateServiceTypeDto): Promise<VehicleServiceTypeEntry> {
    const label = dto.label.replace(/\s+/g, ' ').trim();
    if (label.length < 2) throw new BadRequestException('Service type name is too short');

    await this.ensureSeeded(user.vendorId);

    const duplicate = await this.prisma.vehicleServiceTypeDef.findFirst({
      where: { vendorId: user.vendorId, label: { equals: label, mode: 'insensitive' } },
    });
    if (duplicate) throw new ConflictException(`A service type named "${duplicate.label}" already exists`);

    const key = await this.uniqueKey(user.vendorId, label);

    const created = await this.prisma.vehicleServiceTypeDef.create({
      data: {
        vendorId: user.vendorId,
        key,
        label,
        defaultIntervalKm: dto.defaultIntervalKm ?? null,
        defaultIntervalDays: dto.defaultIntervalDays ?? null,
      },
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'CREATED',
      entity: 'VehicleServiceTypeDef',
      entityId: created.id,
      changes: { after: created },
    });

    return {
      id: created.id,
      key: created.key,
      label: created.label,
      defaultIntervalKm: created.defaultIntervalKm,
      defaultIntervalDays: created.defaultIntervalDays,
      isSystem: created.isSystem,
      usageCount: 0,
    };
  }

  /**
   * Renames a type. The `key` is untouched, so every rule/record keeps
   * pointing at it. Expenses that VehicleMaintenanceService auto-described as
   * "<old label> — <plate>" are re-described with the new label in the same
   * transaction (descriptions someone edited by hand no longer start with the
   * old label and are left alone).
   */
  async rename(user: AuthUser, id: string, dto: UpdateServiceTypeDto): Promise<VehicleServiceTypeEntry> {
    const label = dto.label.replace(/\s+/g, ' ').trim();
    if (label.length < 2) throw new BadRequestException('Service type name is too short');

    const def = await this.prisma.vehicleServiceTypeDef.findFirst({ where: { id, vendorId: user.vendorId } });
    if (!def) throw new NotFoundException('Service type not found');
    if (def.label === label) return this.toEntry(def, await this.usageCount(user.vendorId, def.key));

    const duplicate = await this.prisma.vehicleServiceTypeDef.findFirst({
      where: { vendorId: user.vendorId, label: { equals: label, mode: 'insensitive' }, NOT: { id } },
    });
    if (duplicate) throw new ConflictException(`A service type named "${duplicate.label}" already exists`);

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.vehicleServiceTypeDef.update({ where: { id }, data: { label } });

      const records = await tx.vehicleServiceRecord.findMany({
        where: { vendorId: user.vendorId, serviceType: def.key, expenseId: { not: null } },
        select: { expenseId: true, vehicle: { select: { plateNumber: true } } },
      });
      const expenseIdsByPlate = new Map<string, string[]>();
      for (const r of records) {
        const ids = expenseIdsByPlate.get(r.vehicle.plateNumber) ?? [];
        ids.push(r.expenseId as string);
        expenseIdsByPlate.set(r.vehicle.plateNumber, ids);
      }
      for (const [plate, expenseIds] of expenseIdsByPlate) {
        await tx.expense.updateMany({
          where: { vendorId: user.vendorId, id: { in: expenseIds }, description: `${def.label} — ${plate}` },
          data: { description: `${label} — ${plate}` },
        });
      }
      return next;
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'UPDATED',
      entity: 'VehicleServiceTypeDef',
      entityId: id,
      changes: { before: def, after: updated },
    });

    return this.toEntry(updated, await this.usageCount(user.vendorId, updated.key));
  }

  private usageCount(vendorId: string, key: string) {
    return this.prisma.vehicleServiceRecord.count({ where: { vendorId, serviceType: key } });
  }

  private toEntry(
    d: { id: string; key: string; label: string; defaultIntervalKm: number | null; defaultIntervalDays: number | null; isSystem: boolean },
    usageCount: number,
  ): VehicleServiceTypeEntry {
    return {
      id: d.id,
      key: d.key,
      label: d.label,
      defaultIntervalKm: d.defaultIntervalKm,
      defaultIntervalDays: d.defaultIntervalDays,
      isSystem: d.isSystem,
      usageCount,
    };
  }

  async remove(user: AuthUser, id: string) {
    const def = await this.prisma.vehicleServiceTypeDef.findFirst({ where: { id, vendorId: user.vendorId } });
    if (!def) throw new NotFoundException('Service type not found');
    if (def.isSystem) throw new BadRequestException(`"${def.label}" is a system type and cannot be removed`);

    await this.prisma.$transaction(async (tx) => {
      const used = await tx.vehicleServiceRecord.count({
        where: { vendorId: user.vendorId, serviceType: def.key },
      });
      if (used > 0) {
        throw new ConflictException(
          `"${def.label}" is used in ${used} service record${used === 1 ? '' : 's'} and cannot be removed`,
        );
      }
      // Its per-vehicle interval rules (no history attached) go with it.
      await tx.vehicleMaintenanceRule.deleteMany({
        where: { vendorId: user.vendorId, serviceType: def.key },
      });
      await tx.vehicleServiceTypeDef.delete({ where: { id: def.id } });
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'DELETED',
      entity: 'VehicleServiceTypeDef',
      entityId: def.id,
      changes: { before: def },
    });

    return { deleted: true };
  }

  /**
   * Stable, URL-safe key for a new label. Built-in / existing keys are never
   * reused; labels with no latin letters (e.g. Urdu script) fall back to a
   * random CUSTOM_ key.
   */
  private async uniqueKey(vendorId: string, label: string): Promise<string> {
    const base = slugifyServiceTypeKey(label) || `CUSTOM_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const taken = new Set(
      (
        await this.prisma.vehicleServiceTypeDef.findMany({
          where: { vendorId, key: { startsWith: base } },
          select: { key: true },
        })
      ).map((d) => d.key),
    );
    if (!taken.has(base)) return base;
    for (let n = 2; n < 100; n++) {
      const candidate = `${base.slice(0, MAX_KEY_LENGTH - 3)}_${n}`;
      if (!taken.has(candidate)) return candidate;
    }
    throw new ConflictException('Could not generate a unique key for this service type — try a different name');
  }
}
