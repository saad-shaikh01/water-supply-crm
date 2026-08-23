import { Injectable, NotFoundException, ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { Prisma } from '@prisma/client';
import { VEHICLE_DAILY_ODOMETER_DELTA_CAP_KM, type ChecklistItemResult } from '@water-supply-crm/types';
import type { AuthUser } from '@water-supply-crm/types';
import { InAppNotificationService } from '../notifications/in-app-notification.service';
import { NotificationService } from '../notifications/notification.service';
import { CreateVehicleDailyCheckDto } from './dto/create-vehicle-daily-check.dto';
import { OverrideCriticalCheckDto } from './dto/override-critical-check.dto';
import { UpdateVehicleDailyCheckDto } from './dto/update-vehicle-daily-check.dto';
import { normalizeChecklistResults, hasCriticalFailure } from './fleet-checklist.util';

@Injectable()
export class VehicleCheckService {
  constructor(
    private prisma: PrismaService,
    private inAppNotifications: InAppNotificationService,
    private notifications: NotificationService,
  ) {}

  async create(user: AuthUser, dto: CreateVehicleDailyCheckDto) {
    const sheet = await this.prisma.dailySheet.findFirst({
      where: { id: dto.dailySheetId, vendorId: user.vendorId },
      select: { id: true, vanId: true, driverId: true, isClosed: true },
    });
    if (!sheet) throw new NotFoundException('Daily sheet not found');

    // Own-vehicle-only for DRIVER; Staff/Admin (fleet:update/manage_maintenance
    // holders) may record on any sheet as a correction — plan doc §7.12.
    if (user.role === 'DRIVER' && sheet.driverId !== user.userId) {
      throw new ForbiddenException('You can only record checks for your own delivery van.');
    }
    if (sheet.isClosed) {
      throw new BadRequestException('Cannot record a vehicle check on a closed sheet.');
    }

    const existing = await this.prisma.vehicleDailyCheck.findUnique({
      where: { dailySheetId_checkType: { dailySheetId: sheet.id, checkType: dto.checkType } },
    });
    if (existing) {
      throw new ConflictException(`A ${dto.checkType} check has already been recorded for this sheet.`);
    }

    // §17 Amendment (2026-08-21): the physical vehicle is picked once, on the
    // START check (§17.3) — required and validated (vendor-scoped, active)
    // exactly like FuelLogService validates van ownership. The END check for
    // the same sheet inherits it from that START check rather than asking
    // the driver to re-pick (one trip, one vehicle — §17.5, locked).
    let vehicleId: string | null;
    if (dto.checkType === 'START') {
      if (!dto.vehicleId) {
        throw new BadRequestException('vehicleId is required for a START check.');
      }
      const vehicle = await this.prisma.vehicle.findFirst({
        where: { id: dto.vehicleId, vendorId: user.vendorId },
      });
      if (!vehicle) throw new NotFoundException('Vehicle not found');
      if (!vehicle.isActive) throw new BadRequestException('This vehicle is inactive.');
      vehicleId = vehicle.id;
    } else {
      const startCheck = await this.prisma.vehicleDailyCheck.findUnique({
        where: { dailySheetId_checkType: { dailySheetId: sheet.id, checkType: 'START' } },
        select: { vehicleId: true },
      });
      vehicleId = startCheck?.vehicleId ?? null;
    }

    const normalized = normalizeChecklistResults(dto.checklistResults);
    const criticalFailure = hasCriticalFailure(normalized);

    // Odometer continuity (§17.5 lookup, but the rule itself was tightened
    // 2026-08-23 per owner request — see schema.prisma comment on
    // odometerContinuityFlag): "prior check on this vehicle, by recordedAt,
    // across any van" — not "prior sheet on this van", since one vehicle can
    // serve two different routes on the same day. Falls back to no check at
    // all when the vehicle is unknown (legacy END check with no linked
    // START, pre-Amendment historical data).
    let odometerContinuityFlag = false;
    let continuityNote: string | null = null;
    if (vehicleId) {
      const priorCheck = await this.prisma.vehicleDailyCheck.findFirst({
        where: { vehicleId },
        orderBy: { recordedAt: 'desc' },
      });
      if (priorCheck) {
        const delta = dto.odometerReading - priorCheck.odometerReading;
        // An odometer physically cannot run backwards — this is now a hard
        // reject, not a flag-and-allow (was flag-only before 2026-08-23; a
        // 100km→80km "correction" one route/day apart used to silently save).
        // Covers both cases the owner asked for in one rule: this trip's END
        // vs its own START, AND tomorrow's START vs today's last reading.
        if (delta < 0) {
          throw new BadRequestException(
            `Odometer reading (${dto.odometerReading} km) is lower than this vehicle's last recorded reading (${priorCheck.odometerReading} km, ${priorCheck.checkType} check). An odometer cannot go backwards — enter the correct value.`,
          );
        }
        if (delta > VEHICLE_DAILY_ODOMETER_DELTA_CAP_KM) {
          odometerContinuityFlag = true;
          continuityNote = `Reading jumped ${delta} km since the previous recorded check — please confirm this is correct.`;
        }
      }
    }

    const check = await this.prisma.$transaction(async (tx) => {
      const created = await tx.vehicleDailyCheck.create({
        data: {
          vendorId: user.vendorId,
          vanId: sheet.vanId,
          vehicleId,
          dailySheetId: sheet.id,
          checkType: dto.checkType,
          odometerReading: dto.odometerReading,
          odometerPhotoKey: dto.odometerPhotoKey ?? null,
          fuelGaugeLevel: dto.fuelGaugeLevel ?? null,
          checklistResults: normalized as unknown as Prisma.InputJsonValue,
          hasCriticalFailure: criticalFailure,
          odometerContinuityFlag,
          continuityNote,
          damageNoted: dto.damageNoted ?? false,
          damageNote: dto.damageNote ?? null,
          damagePhotoKeys: dto.damagePhotoKeys ?? [],
          note: dto.note ?? null,
          recordedById: user.userId,
        },
      });

      if (vehicleId) {
        await tx.vehicleProfile.upsert({
          where: { vehicleId },
          create: { vendorId: user.vendorId, vehicleId, currentOdometer: dto.odometerReading },
          update: { currentOdometer: dto.odometerReading },
        });
      }

      return created;
    });

    if (criticalFailure) {
      await this.notifyCriticalFailure(user.vendorId, vehicleId, check.id, normalized);
    }

    return check;
  }

  async getForSheet(user: AuthUser, dailySheetId: string) {
    const sheet = await this.prisma.dailySheet.findFirst({
      where: { id: dailySheetId, vendorId: user.vendorId },
      select: { id: true, driverId: true },
    });
    if (!sheet) throw new NotFoundException('Daily sheet not found');
    if (user.role === 'DRIVER' && sheet.driverId !== user.userId) {
      throw new ForbiddenException('You can only view checks for your own delivery van.');
    }

    return this.prisma.vehicleDailyCheck.findMany({
      where: { dailySheetId },
      include: {
        recordedBy: { select: { id: true, name: true } },
        odometerEditedBy: { select: { id: true, name: true } },
      },
      orderBy: { recordedAt: 'asc' },
    });
  }

  /**
   * Odometer Correction (2026-08-23, owner request): Staff/Admin fixes a
   * mis-entered odometer reading after the fact — the "already submitted"
   * lock this feature had until now. Guarded by the exact same
   * can't-go-backwards rule as `create()`, but checked against BOTH
   * neighbours (the check wasn't necessarily the vehicle's most recent one
   * by the time it's edited): the reading immediately BEFORE this one must
   * still be lower, and the reading immediately AFTER this one (if any —
   * e.g. correcting a START after its own END is already recorded) must
   * still be higher. `originalOdometerReading` is stamped once, on the
   * first-ever edit, and never touched again — see schema.prisma comment.
   */
  async update(user: AuthUser, id: string, dto: UpdateVehicleDailyCheckDto) {
    const check = await this.prisma.vehicleDailyCheck.findFirst({ where: { id, vendorId: user.vendorId } });
    if (!check) throw new NotFoundException('Vehicle check not found');

    // Recomputed below (not just validated against) so an edit that removes
    // a large jump also clears a stale flag, and one that introduces a new
    // jump against its neighbour gets flagged same as create() would.
    let odometerContinuityFlag = false;
    let continuityNote: string | null = null;

    if (check.vehicleId) {
      const [predecessor, successor] = await Promise.all([
        this.prisma.vehicleDailyCheck.findFirst({
          where: { vehicleId: check.vehicleId, recordedAt: { lt: check.recordedAt } },
          orderBy: { recordedAt: 'desc' },
        }),
        this.prisma.vehicleDailyCheck.findFirst({
          where: { vehicleId: check.vehicleId, recordedAt: { gt: check.recordedAt } },
          orderBy: { recordedAt: 'asc' },
        }),
      ]);

      if (predecessor && dto.odometerReading < predecessor.odometerReading) {
        throw new BadRequestException(
          `Odometer reading (${dto.odometerReading} km) is lower than this vehicle's prior recorded reading (${predecessor.odometerReading} km, ${predecessor.checkType} check). An odometer cannot go backwards — enter the correct value.`,
        );
      }
      if (successor && dto.odometerReading > successor.odometerReading) {
        throw new BadRequestException(
          `Odometer reading (${dto.odometerReading} km) is higher than this vehicle's next recorded reading (${successor.odometerReading} km, ${successor.checkType} check) — that would make the odometer go backwards between the two. Enter a value no higher than ${successor.odometerReading} km.`,
        );
      }
      if (predecessor) {
        const delta = dto.odometerReading - predecessor.odometerReading;
        if (delta > VEHICLE_DAILY_ODOMETER_DELTA_CAP_KM) {
          odometerContinuityFlag = true;
          continuityNote = `Reading jumped ${delta} km since the previous recorded check — please confirm this is correct.`;
        }
      }

      const isMostRecentForVehicle = !successor;
      return this.prisma.$transaction(async (tx) => {
        const result = await tx.vehicleDailyCheck.update({
          where: { id },
          data: {
            odometerReading: dto.odometerReading,
            // Preserve the as-submitted value on the FIRST edit only.
            originalOdometerReading: check.originalOdometerReading ?? check.odometerReading,
            odometerEditedById: user.userId,
            odometerEditedAt: new Date(),
            odometerEditReason: dto.reason,
            odometerContinuityFlag,
            continuityNote,
          },
        });

        if (isMostRecentForVehicle) {
          await tx.vehicleProfile.upsert({
            where: { vehicleId: check.vehicleId as string },
            create: { vendorId: user.vendorId, vehicleId: check.vehicleId as string, currentOdometer: dto.odometerReading },
            update: { currentOdometer: dto.odometerReading },
          });
        }

        return result;
      });
    }

    // No linked vehicle (legacy pre-Amendment row) — nothing to validate
    // continuity against, and no VehicleProfile to sync.
    return this.prisma.vehicleDailyCheck.update({
      where: { id },
      data: {
        odometerReading: dto.odometerReading,
        originalOdometerReading: check.originalOdometerReading ?? check.odometerReading,
        odometerEditedById: user.userId,
        odometerEditedAt: new Date(),
        odometerEditReason: dto.reason,
        odometerContinuityFlag: false,
        continuityNote: null,
      },
    });
  }

  async overrideCritical(user: AuthUser, id: string, dto: OverrideCriticalCheckDto) {
    const check = await this.prisma.vehicleDailyCheck.findFirst({ where: { id, vendorId: user.vendorId } });
    if (!check) throw new NotFoundException('Vehicle check not found');
    if (!check.hasCriticalFailure) {
      throw new BadRequestException('This check has no unresolved critical failure to override.');
    }
    if (check.criticalOverrideById) {
      throw new ConflictException('This critical failure has already been acknowledged.');
    }

    return this.prisma.vehicleDailyCheck.update({
      where: { id },
      data: {
        criticalOverrideById: user.userId,
        criticalOverrideAt: new Date(),
        criticalOverrideNote: dto.note,
      },
    });
  }

  /**
   * The hard 409 gate this feature adds to trip start (plan doc §7.2: the
   * start-of-day check is "Mandatory" and folds into the crew-confirm gate),
   * exactly like the existing crewConfirmed gate: (1) a START check must
   * exist at all, and (2) if it exists, it must not carry an unacknowledged
   * critical failure. Previously only (2) was enforced — a missing check
   * was a frontend nudge only — but that undershot the plan's own "mandatory"
   * intent, so it's now a hard block same as crew confirmation.
   */
  async assertTripStartClear(vendorId: string, dailySheetId: string): Promise<void> {
    const startCheck = await this.prisma.vehicleDailyCheck.findUnique({
      where: { dailySheetId_checkType: { dailySheetId, checkType: 'START' } },
      select: { hasCriticalFailure: true, criticalOverrideById: true },
    });
    if (!startCheck) {
      throw new ConflictException(
        'A start-of-day vehicle check is required before the trip can start.',
      );
    }
    if (startCheck.hasCriticalFailure && !startCheck.criticalOverrideById) {
      throw new ConflictException(
        'A critical vehicle issue was reported this morning and must be acknowledged by Staff/Admin before the trip can start.',
      );
    }
  }

  /**
   * The mirror-image gate for sheet close (Soft Close feature, Amendment R9):
   * an END check must exist and carry no unacknowledged critical failure,
   * exactly like assertTripStartClear does for trip start. Called by both
   * the direct Staff/Admin close and the Driver/Salesman self-close request
   * (daily-sheet.service.ts's closeSheet/requestClose) — so this data point
   * is captured consistently regardless of which closure path is used.
   */
  async assertTripEndClear(vendorId: string, dailySheetId: string): Promise<void> {
    const endCheck = await this.prisma.vehicleDailyCheck.findUnique({
      where: { dailySheetId_checkType: { dailySheetId, checkType: 'END' } },
      select: { hasCriticalFailure: true, criticalOverrideById: true },
    });
    if (!endCheck) {
      throw new ConflictException(
        'An end-of-day vehicle check is required before the sheet can be closed.',
      );
    }
    if (endCheck.hasCriticalFailure && !endCheck.criticalOverrideById) {
      throw new ConflictException(
        'A critical vehicle issue was reported this evening and must be acknowledged by Staff/Admin before the sheet can be closed.',
      );
    }
  }

  private async notifyCriticalFailure(
    vendorId: string,
    vehicleId: string | null,
    checkId: string,
    results: ChecklistItemResult[],
  ) {
    const [vehicle, failedItems, adminUsers] = await Promise.all([
      vehicleId
        ? this.prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { plateNumber: true } })
        : Promise.resolve(null),
      Promise.resolve(results.filter((r) => r.isCritical && !r.passed).map((r) => r.label)),
      this.prisma.user.findMany({
        where: { vendorId, role: { in: ['VENDOR_ADMIN', 'STAFF'] }, isActive: true },
        select: { id: true },
      }),
    ]);

    const title = `Critical Vehicle Issue — ${vehicle?.plateNumber ?? 'Vehicle'}`;
    const message = `${failedItems.join(', ')} flagged on ${vehicle?.plateNumber ?? 'a vehicle'}'s pre-trip check. Trip is blocked until acknowledged.`;

    await Promise.all(
      adminUsers.map(async (admin) => {
        await this.inAppNotifications.create({
          userId: admin.id,
          vendorId,
          type: 'VEHICLE_CRITICAL_CHECK_FAILURE',
          title,
          message,
          entityId: checkId,
        });
        await this.notifications.queueFcm(admin.id, title, message, { type: 'VEHICLE_CRITICAL_CHECK_FAILURE', checkId });
      }),
    );
  }
}
