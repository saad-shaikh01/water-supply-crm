import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { DamageCaseStatus, DamageCaseType, TransactionType } from '@prisma/client';
import { paginate } from '../../common/helpers/paginate';
import { StorageService } from '../../common/storage/storage.service';
import { InAppNotificationService } from '../notifications/in-app-notification.service';
import { FcmService } from '../fcm/fcm.service';
import { ReportDamageCaseDto } from './dto/report-damage-case.dto';
import { UpdateDamageCaseDto } from './dto/update-damage-case.dto';
import { ChargeDamageCaseDto } from './dto/charge-damage-case.dto';
import { WaiveDamageCaseDto } from './dto/waive-damage-case.dto';
import { DamageCaseQueryDto } from './dto/damage-case-query.dto';
import type { AuthUser } from '@water-supply-crm/types';

@Injectable()
export class DamageCaseService {
  private readonly logger = new Logger(DamageCaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly inAppNotifications: InAppNotificationService,
    private readonly fcm: FcmService,
  ) {}

  // ── report ────────────────────────────────────────────────────────────────

  async report(user: AuthUser, dto: ReportDamageCaseDto) {
    const damageCase = await this.prisma.damageCase.create({
      data: {
        vendorId: user.vendorId,
        customerId: dto.customerId,
        productId: dto.productId,
        driverId: user.userId,
        dailySheetItemId: dto.dailySheetItemId ?? null,
        caseType: dto.caseType ?? DamageCaseType.DAMAGE,
        lossReason: dto.lossReason ?? null,
        severity: dto.severity ?? null,
        bottleCount: dto.bottleCount,
        description: dto.description ?? null,
        photoKeys: dto.photoKeys,
        status: DamageCaseStatus.REPORTED,
        version: 0,
      },
    });

    await this.prisma.damageCaseAuditLog.create({
      data: {
        damageCaseId: damageCase.id,
        actorId: user.userId,
        actorRole: user.role,
        action: 'REPORTED',
        payload: {
          customerId: dto.customerId,
          productId: dto.productId,
          severity: dto.severity,
          bottleCount: dto.bottleCount,
        },
      },
    });

    // Notify STAFF + VENDOR_ADMIN via in-app notification (fire-and-forget)
    this.notifyVendorStaff(
      user.vendorId,
      damageCase.id,
      'New Damage Case Reported',
      dto.caseType === DamageCaseType.LOST
        ? `A lost bottle case has been reported (${dto.bottleCount} bottle(s)).`
        : `A ${dto.severity?.toLowerCase() ?? 'damage'} damage case has been reported (${dto.bottleCount} bottle(s)).`,
    ).catch((e) => this.logger.warn(`Notification failed: ${e?.message}`));

    return damageCase;
  }

  // ── update (bottleCount only, REPORTED status) ─────────────────────────

  async update(user: AuthUser, id: string, dto: UpdateDamageCaseDto) {
    const damageCase = await this.findCaseOrThrow(id);

    if (damageCase.status !== DamageCaseStatus.REPORTED) {
      throw new BadRequestException('Only REPORTED damage cases can be updated.');
    }

    if (user.role === 'DRIVER' && damageCase.driverId !== user.userId) {
      throw new ForbiddenException('Drivers can only update their own damage cases.');
    }

    if (damageCase.version !== dto.version) {
      throw new ConflictException(
        `Version mismatch: expected ${damageCase.version}, received ${dto.version}. Reload and retry.`,
      );
    }

    const before = { bottleCount: damageCase.bottleCount };
    const after = { bottleCount: dto.bottleCount };

    const updated = await this.prisma.damageCase.update({
      where: { id },
      data: {
        bottleCount: dto.bottleCount,
        version: { increment: 1 },
      },
    });

    await this.prisma.damageCaseAuditLog.create({
      data: {
        damageCaseId: id,
        actorId: user.userId,
        actorRole: user.role,
        action: 'UPDATED',
        payload: { before, after },
      },
    });

    return updated;
  }

  // ── review (REPORTED → UNDER_REVIEW) ────────────────────────────────────

  async review(user: AuthUser, id: string) {
    const damageCase = await this.findCaseOrThrow(id);

    if (damageCase.status !== DamageCaseStatus.REPORTED) {
      throw new BadRequestException('Only REPORTED damage cases can be moved to UNDER_REVIEW.');
    }

    const updated = await this.prisma.damageCase.update({
      where: { id },
      data: {
        status: DamageCaseStatus.UNDER_REVIEW,
        reviewedById: user.userId,
        reviewedAt: new Date(),
        version: { increment: 1 },
      },
    });

    await this.prisma.damageCaseAuditLog.create({
      data: {
        damageCaseId: id,
        actorId: user.userId,
        actorRole: user.role,
        action: 'UNDER_REVIEW',
        payload: { previousStatus: DamageCaseStatus.REPORTED },
      },
    });

    return updated;
  }

  // ── charge ───────────────────────────────────────────────────────────────

  async charge(user: AuthUser, id: string, dto: ChargeDamageCaseDto) {
    // Service-level guard: Condition 5
    if (dto.chargeAmount <= 0) {
      throw new BadRequestException('chargeAmount must be greater than zero.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const damageCase = await tx.damageCase.findUnique({ where: { id } });
      if (!damageCase) throw new NotFoundException('Damage case not found.');

      if (damageCase.status !== DamageCaseStatus.UNDER_REVIEW) {
        throw new BadRequestException('Only UNDER_REVIEW damage cases can be charged.');
      }

      if (damageCase.version !== dto.version) {
        throw new ConflictException(
          `Version mismatch: expected ${damageCase.version}, received ${dto.version}. Reload and retry.`,
        );
      }

      // hasPhotos gate
      if (damageCase.caseType !== DamageCaseType.LOST && damageCase.photoKeys.length === 0) {
        throw new BadRequestException(
          'At least one damage photo is required before charging.',
        );
      }

      // Check BottleWallet balance
      const wallet = await tx.bottleWallet.findUnique({
        where: {
          customerId_productId: {
            customerId: damageCase.customerId,
            productId: damageCase.productId,
          },
        },
      });

      if (!wallet || wallet.balance < damageCase.bottleCount) {
        throw new BadRequestException(
          'Bottle wallet balance insufficient — reconcile manually using /transactions/adjustments',
        );
      }

      // For LOST cases: decrement bottle wallet (bottle was never returned — still outstanding in wallet)
      if (damageCase.caseType === DamageCaseType.LOST) {
        await tx.bottleWallet.update({
          where: {
            customerId_productId: {
              customerId: damageCase.customerId,
              productId: damageCase.productId,
            },
          },
          data: { balance: { decrement: damageCase.bottleCount } },
        });
      }

      // Increment customer financial balance (charge the customer)
      await tx.customer.update({
        where: { id: damageCase.customerId },
        data: { financialBalance: { increment: dto.chargeAmount } },
      });

      // Create a transaction record for this charge
      const chargeTx = await tx.transaction.create({
        data: {
          type: TransactionType.ADJUSTMENT,
          vendorId: damageCase.vendorId,
          customerId: damageCase.customerId,
          amount: dto.chargeAmount,
          bottleCount: -damageCase.bottleCount,
          description: damageCase.caseType === DamageCaseType.LOST
            ? `Lost bottle charge – case #${id}`
            : `Bottle damage charge – case #${id}`,
        },
      });

      // Update the damage case to CHARGED
      const updatedCase = await tx.damageCase.update({
        where: { id },
        data: {
          status: DamageCaseStatus.CHARGED,
          transactionId: chargeTx.id,
          chargeAmount: dto.chargeAmount,
          reviewedById: user.userId,
          reviewedAt: new Date(),
          reviewNote: dto.reviewNote ?? null,
          writeOffCategory: dto.writeOffCategory,
          version: { increment: 1 },
        },
      });

      // Write audit log
      await tx.damageCaseAuditLog.create({
        data: {
          damageCaseId: id,
          actorId: user.userId,
          actorRole: user.role,
          action: 'CHARGED',
          payload: {
            chargeAmount: dto.chargeAmount,
            bottleCount: damageCase.bottleCount,
            writeOffCategory: dto.writeOffCategory,
          },
        },
      });

      return { updatedCase, customerId: damageCase.customerId, vendorId: damageCase.vendorId };
    });

    // Fire-and-forget: FCM + InApp to customer
    this.notifyCustomer(
      result.customerId,
      result.updatedCase.id,
      'Damage Case Charged',
      `A bottle damage charge of ${dto.chargeAmount} has been applied to your account.`,
    ).catch((e) => this.logger.warn(`Customer notification failed: ${e?.message}`));

    return result.updatedCase;
  }

  // ── waive ────────────────────────────────────────────────────────────────

  async waive(user: AuthUser, id: string, dto: WaiveDamageCaseDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      const damageCase = await tx.damageCase.findUnique({ where: { id } });
      if (!damageCase) throw new NotFoundException('Damage case not found.');

      if (damageCase.status !== DamageCaseStatus.UNDER_REVIEW) {
        throw new BadRequestException('Only UNDER_REVIEW damage cases can be waived.');
      }

      if (damageCase.version !== dto.version) {
        throw new ConflictException(
          `Version mismatch: expected ${damageCase.version}, received ${dto.version}. Reload and retry.`,
        );
      }

      // Check BottleWallet balance
      const wallet = await tx.bottleWallet.findUnique({
        where: {
          customerId_productId: {
            customerId: damageCase.customerId,
            productId: damageCase.productId,
          },
        },
      });

      if (!wallet || wallet.balance < damageCase.bottleCount) {
        throw new BadRequestException(
          'Bottle wallet balance insufficient — reconcile manually using /transactions/adjustments',
        );
      }

      // For LOST cases: decrement bottle wallet (bottle was never returned — business absorbs cost)
      if (damageCase.caseType === DamageCaseType.LOST) {
        await tx.bottleWallet.update({
          where: {
            customerId_productId: {
              customerId: damageCase.customerId,
              productId: damageCase.productId,
            },
          },
          data: { balance: { decrement: damageCase.bottleCount } },
        });
      }

      // Condition 3: BottleWallet.balance is NOT reconciled from the sum of Transaction.bottleCount values.
      // The ledger service always updates BottleWallet.balance directly and independently creates a
      // Transaction row with bottleCount for analytics/dashboard reporting only. There is no cron or
      // reconciliation job that recomputes BottleWallet.balance from Transaction.bottleCount sums.
      // Therefore, we do NOT need to create a zero-amount Transaction row for bookkeeping consistency
      // of the wallet balance. The wallet is the source of truth — no Transaction row needed for WAIVE.
      //
      // Wallet balance is NOT decremented here (for DAMAGE cases) — the delivery recordDelivery() already
      // decremented it via emptyReceived. Decrementing again would double-count.
      //
      // If this assumption changes in the future (e.g. a reconciliation job is added), a
      // zero-amount Transaction with bottleCount: -damageCase.bottleCount should be created here.

      // Update the damage case to WAIVED
      const updatedCase = await tx.damageCase.update({
        where: { id },
        data: {
          status: DamageCaseStatus.WAIVED,
          reviewedById: user.userId,
          reviewedAt: new Date(),
          reviewNote: dto.reviewNote ?? null,
          writeOffCategory: dto.writeOffCategory,
          version: { increment: 1 },
        },
      });

      // Write audit log
      await tx.damageCaseAuditLog.create({
        data: {
          damageCaseId: id,
          actorId: user.userId,
          actorRole: user.role,
          action: 'WAIVED',
          payload: {
            bottleCount: damageCase.bottleCount,
            writeOffCategory: dto.writeOffCategory,
            reviewNote: dto.reviewNote ?? null,
          },
        },
      });

      return updatedCase;
    });

    return result;
  }

  // ── reverse (CHARGED → REVERSED; credits money only) ────────────────────

  async reverse(user: AuthUser, id: string, dto: { version: number }) {
    const result = await this.prisma.$transaction(async (tx) => {
      const damageCase = await tx.damageCase.findUnique({ where: { id } });
      if (!damageCase) throw new NotFoundException('Damage case not found.');

      if (damageCase.status !== DamageCaseStatus.CHARGED) {
        throw new BadRequestException('Only CHARGED damage cases can be reversed.');
      }

      if (damageCase.version !== dto.version) {
        throw new ConflictException(
          `Version mismatch: expected ${damageCase.version}, received ${dto.version}. Reload and retry.`,
        );
      }

      // Reversal credits MONEY ONLY. Do NOT restore bottle wallet — physical bottles are gone.
      await tx.customer.update({
        where: { id: damageCase.customerId },
        data: { financialBalance: { decrement: damageCase.chargeAmount! } },
      });

      // Create reversal transaction
      await tx.transaction.create({
        data: {
          type: TransactionType.ADJUSTMENT,
          vendorId: damageCase.vendorId,
          customerId: damageCase.customerId,
          amount: -(damageCase.chargeAmount!),
          description: `Bottle damage reversal – case #${id} (money only — bottle wallet not restored; use /transactions/adjustments to correct wallet if needed)`,
        },
      });

      const updatedCase = await tx.damageCase.update({
        where: { id },
        data: {
          status: DamageCaseStatus.REVERSED,
          version: { increment: 1 },
        },
      });

      await tx.damageCaseAuditLog.create({
        data: {
          damageCaseId: id,
          actorId: user.userId,
          actorRole: user.role,
          action: 'REVERSED',
          payload: {
            chargeAmount: damageCase.chargeAmount,
            note: 'Bottle wallet NOT restored — physical bottles are gone. Operator must use /transactions/adjustments if wallet correction is needed.',
          },
        },
      });

      return updatedCase;
    });

    return result;
  }

  // ── findAll ──────────────────────────────────────────────────────────────

  async findAll(user: AuthUser, query: DamageCaseQueryDto) {
    const { page = 1, limit = 20, status, customerId, driverId, vanId, severity, dateFrom, dateTo } = query;

    const where: any = { vendorId: user.vendorId };
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;
    if (driverId) where.driverId = driverId;
    if (severity) where.severity = severity;
    if (vanId) {
      where.dailySheetItem = { dailySheet: { vanId } };
    }
    if (dateFrom || dateTo) {
      const dateFilter: any = {};
      if (dateFrom) dateFilter.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      where.createdAt = dateFilter;
    }

    const [data, total] = await Promise.all([
      this.prisma.damageCase.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, customerCode: true } },
          product: { select: { id: true, name: true } },
          driver: { select: { id: true, name: true } },
          reviewedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.damageCase.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  // ── findOne ──────────────────────────────────────────────────────────────

  async findOne(user: AuthUser, id: string) {
    const damageCase = await this.prisma.damageCase.findFirst({
      where: {
        id,
        vendorId: user.vendorId,
        ...(user.role === 'DRIVER' ? { driverId: user.userId } : {}),
      },
      include: {
        customer: { select: { id: true, name: true, customerCode: true } },
        product: { select: { id: true, name: true } },
        driver: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
        dailySheetItem: { select: { id: true, sequence: true, status: true } },
        transaction: true,
      },
    });

    if (!damageCase) {
      throw new NotFoundException('Damage case not found.');
    }

    // Generate signed URLs for photo keys
    const photoUrls = await Promise.all(
      damageCase.photoKeys.map((key) => this.storage.getSignedUrl(key)),
    );

    return { ...damageCase, photoUrls };
  }

  // ── getMyCases (DRIVER) ──────────────────────────────────────────────────

  async getMyCases(user: AuthUser, query: DamageCaseQueryDto) {
    const { page = 1, limit = 20, status, severity, dateFrom, dateTo } = query;

    const where: any = {
      driverId: user.userId,
      vendorId: user.vendorId,
    };
    if (status) where.status = status;
    if (severity) where.severity = severity;
    if (dateFrom || dateTo) {
      const dateFilter: any = {};
      if (dateFrom) dateFilter.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      where.createdAt = dateFilter;
    }

    const [data, total] = await Promise.all([
      this.prisma.damageCase.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, customerCode: true } },
          product: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.damageCase.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  // ── getAuditLog ──────────────────────────────────────────────────────────

  async getAuditLog(user: AuthUser, id: string) {
    // Ensure case belongs to this vendor
    const damageCase = await this.prisma.damageCase.findFirst({
      where: { id, vendorId: user.vendorId },
      select: { id: true },
    });

    if (!damageCase) {
      throw new NotFoundException('Damage case not found.');
    }

    return this.prisma.damageCaseAuditLog.findMany({
      where: { damageCaseId: id },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private async findCaseOrThrow(id: string) {
    const damageCase = await this.prisma.damageCase.findUnique({ where: { id } });
    if (!damageCase) throw new NotFoundException('Damage case not found.');
    return damageCase;
  }

  private async notifyVendorStaff(
    vendorId: string,
    entityId: string,
    title: string,
    message: string,
  ) {
    const staffUsers = await this.prisma.user.findMany({
      where: {
        vendorId,
        isActive: true,
        role: { in: ['STAFF', 'VENDOR_ADMIN'] },
      },
      select: { id: true },
    });

    if (staffUsers.length) {
      await this.prisma.inAppNotification.createMany({
        data: staffUsers.map((u) => ({
          userId: u.id,
          vendorId,
          type: 'DAMAGE_CASE_REPORTED',
          title,
          message,
          entityId,
        })),
      });
    }

    await this.fcm.sendToVendorUsers(vendorId, title, message, {
      type: 'DAMAGE_CASE_REPORTED',
      damageCaseId: entityId,
    });
  }

  private async notifyCustomer(
    customerId: string,
    damageCaseId: string,
    title: string,
    message: string,
  ) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { userId: true, vendorId: true },
    });

    if (!customer?.userId) return;

    await this.inAppNotifications.create({
      userId: customer.userId,
      vendorId: customer.vendorId,
      type: 'DAMAGE_CASE_CHARGED',
      title,
      message,
      entityId: damageCaseId,
    });

    await this.fcm.sendToUser(customer.userId, title, message, {
      type: 'DAMAGE_CASE_CHARGED',
      damageCaseId,
    });
  }
}
