import { Injectable, NotFoundException, ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { Prisma } from '@prisma/client';
import { VEHICLE_DAILY_ODOMETER_DELTA_CAP_KM, type ChecklistItemResult } from '@water-supply-crm/types';
import type { AuthUser } from '@water-supply-crm/types';
import { InAppNotificationService } from '../notifications/in-app-notification.service';
import { NotificationService } from '../notifications/notification.service';
import { CreateVehicleDailyCheckDto } from './dto/create-vehicle-daily-check.dto';
import { OverrideCriticalCheckDto } from './dto/override-critical-check.dto';
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

    const normalized = normalizeChecklistResults(dto.checklistResults);
    const criticalFailure = hasCriticalFailure(normalized);

    const priorCheck = await this.prisma.vehicleDailyCheck.findFirst({
      where: { vanId: sheet.vanId },
      orderBy: { recordedAt: 'desc' },
    });

    let odometerContinuityFlag = false;
    let continuityNote: string | null = null;
    if (priorCheck) {
      const delta = dto.odometerReading - priorCheck.odometerReading;
      if (delta < 0) {
        odometerContinuityFlag = true;
        continuityNote = `Reading is ${Math.abs(delta)} km lower than the previous recorded check (${priorCheck.odometerReading} km).`;
      } else if (delta > VEHICLE_DAILY_ODOMETER_DELTA_CAP_KM) {
        odometerContinuityFlag = true;
        continuityNote = `Reading jumped ${delta} km since the previous recorded check — please confirm this is correct.`;
      }
    }

    const check = await this.prisma.$transaction(async (tx) => {
      const created = await tx.vehicleDailyCheck.create({
        data: {
          vendorId: user.vendorId,
          vanId: sheet.vanId,
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

      await tx.vehicleProfile.upsert({
        where: { vanId: sheet.vanId },
        create: { vendorId: user.vendorId, vanId: sheet.vanId, currentOdometer: dto.odometerReading },
        update: { currentOdometer: dto.odometerReading },
      });

      return created;
    });

    if (criticalFailure) {
      await this.notifyCriticalFailure(user.vendorId, sheet.vanId, check.id, normalized);
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
      include: { recordedBy: { select: { id: true, name: true } } },
      orderBy: { recordedAt: 'asc' },
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
   * The one hard 409 gate this feature adds to trip start (plan doc §6): a
   * START check with an unacknowledged critical failure blocks createLoad/
   * loadOut, exactly like the existing crewConfirmed gate. A missing check
   * entirely does NOT block — that's a frontend nudge only (mirrors
   * hasPromptedCrewConfirm) — so pre-existing open sheets from before this
   * feature shipped are completely unaffected.
   */
  async assertTripStartClear(vendorId: string, dailySheetId: string): Promise<void> {
    const startCheck = await this.prisma.vehicleDailyCheck.findUnique({
      where: { dailySheetId_checkType: { dailySheetId, checkType: 'START' } },
      select: { hasCriticalFailure: true, criticalOverrideById: true },
    });
    if (startCheck?.hasCriticalFailure && !startCheck.criticalOverrideById) {
      throw new ConflictException(
        'A critical vehicle issue was reported this morning and must be acknowledged by Staff/Admin before the trip can start.',
      );
    }
  }

  private async notifyCriticalFailure(
    vendorId: string,
    vanId: string,
    checkId: string,
    results: ChecklistItemResult[],
  ) {
    const [van, failedItems, adminUsers] = await Promise.all([
      this.prisma.van.findUnique({ where: { id: vanId }, select: { plateNumber: true } }),
      Promise.resolve(results.filter((r) => r.isCritical && !r.passed).map((r) => r.label)),
      this.prisma.user.findMany({
        where: { vendorId, role: { in: ['VENDOR_ADMIN', 'STAFF'] }, isActive: true },
        select: { id: true },
      }),
    ]);

    const title = `Critical Vehicle Issue — ${van?.plateNumber ?? 'Van'}`;
    const message = `${failedItems.join(', ')} flagged on ${van?.plateNumber ?? 'a van'}'s pre-trip check. Trip is blocked until acknowledged.`;

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
