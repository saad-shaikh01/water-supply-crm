import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AnnouncementAudience, AnnouncementStatus, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '@water-supply-crm/database';
import { JOB_NAMES, QUEUE_NAMES } from '@water-supply-crm/queue';
import type { AuthUser } from '@water-supply-crm/types';
import { paginate } from '../../common/helpers/paginate';
import { AuditService } from '../audit/audit.service';
import { CreateAnnouncementDto, ListAnnouncementsQueryDto, UpdateAnnouncementDto } from './dto/announcement.dto';

const EDITABLE: AnnouncementStatus[] = [AnnouncementStatus.DRAFT, AnnouncementStatus.SCHEDULED];
const SENDABLE: AnnouncementStatus[] = [
  AnnouncementStatus.DRAFT,
  AnnouncementStatus.SCHEDULED,
  AnnouncementStatus.FAILED, // retry via resend (dispatch is idempotent)
];
/** A SENDING announcement untouched this long is considered orphaned and re-enqueued by the scan. */
export const SENDING_STALE_MS = 5 * 60_000;

@Injectable()
export class AnnouncementService {
  private readonly logger = new Logger(AnnouncementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUE_NAMES.ANNOUNCEMENTS) private readonly queue: Queue,
  ) {}

  async list(query: ListAnnouncementsQueryDto) {
    const { page = 1, limit = 20, status } = query;
    const where: Prisma.AnnouncementWhereInput = status ? { status } : {};
    const [data, total] = await Promise.all([
      this.prisma.announcement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { _count: { select: { vendors: true } } },
      }),
      this.prisma.announcement.count({ where }),
    ]);
    return paginate(data, total, page, limit);
  }

  async findOne(id: string) {
    const a = await this.prisma.announcement.findUnique({
      where: { id },
      include: { vendors: { include: { vendor: { select: { id: true, name: true } } } } },
    });
    if (!a) throw new NotFoundException('Announcement not found');
    return a;
  }

  async create(dto: CreateAnnouncementDto, actor: AuthUser) {
    const audience = dto.audience ?? AnnouncementAudience.ALL_VENDORS;
    const vendorIds = await this.validateTargets(audience, dto.vendorIds);
    const scheduledFor = this.parseFuture(dto.scheduledFor);

    const created = await this.prisma.announcement.create({
      data: {
        title: dto.title.trim(),
        body: dto.body.trim(),
        severity: dto.severity,
        audience,
        status: scheduledFor ? AnnouncementStatus.SCHEDULED : AnnouncementStatus.DRAFT,
        scheduledFor,
        createdById: actor.userId,
        createdByName: actor.name,
        vendors: { create: vendorIds.map((vendorId) => ({ vendorId })) },
      },
    });
    await this.auditLog(actor, 'CREATE', created.id, { after: { ...dto, status: created.status } });
    return this.findOne(created.id);
  }

  async update(id: string, dto: UpdateAnnouncementDto, actor: AuthUser) {
    const before = await this.findOne(id);
    if (!EDITABLE.includes(before.status)) {
      throw new ConflictException(`Announcement in status ${before.status} cannot be edited`);
    }

    const audience = dto.audience ?? before.audience;
    const data: Prisma.AnnouncementUpdateManyMutationInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.body !== undefined) data.body = dto.body.trim();
    if (dto.severity !== undefined) data.severity = dto.severity;
    data.audience = audience;

    let vendorIds: string[] | undefined;
    if (dto.vendorIds !== undefined || dto.audience !== undefined) {
      const given = dto.vendorIds ?? before.vendors.map((v) => v.vendorId);
      vendorIds = await this.validateTargets(audience, given);
    }

    if (dto.scheduledFor !== undefined) {
      if (dto.scheduledFor === null) {
        data.scheduledFor = null;
        data.status = AnnouncementStatus.DRAFT;
      } else {
        data.scheduledFor = this.parseFuture(dto.scheduledFor);
        data.status = AnnouncementStatus.SCHEDULED;
      }
    }

    // Guard against a concurrent claim (send/scan) between read and write.
    const res = await this.prisma.announcement.updateMany({
      where: { id, status: { in: EDITABLE } },
      data,
    });
    if (res.count === 0) throw new ConflictException('Announcement is no longer editable');
    if (vendorIds) {
      await this.prisma.$transaction([
        this.prisma.announcementVendor.deleteMany({ where: { announcementId: id } }),
        this.prisma.announcementVendor.createMany({
          data: vendorIds.map((vendorId) => ({ announcementId: id, vendorId })),
        }),
      ]);
    }
    const after = await this.findOne(id);
    await this.auditLog(actor, 'UPDATE', id, { before: { title: before.title, status: before.status }, after: dto });
    return after;
  }

  async remove(id: string, actor: AuthUser) {
    const a = await this.findOne(id);
    const res = await this.prisma.announcement.deleteMany({ where: { id, status: AnnouncementStatus.DRAFT } });
    if (res.count === 0) throw new ConflictException(`Only DRAFT announcements can be deleted (status ${a.status})`);
    await this.auditLog(actor, 'DELETE', id, { before: { title: a.title } });
    return { ok: true };
  }

  async cancel(id: string, actor: AuthUser) {
    await this.findOne(id);
    const res = await this.prisma.announcement.updateMany({
      where: { id, status: { in: EDITABLE } },
      data: { status: AnnouncementStatus.CANCELLED, cancelledAt: new Date() },
    });
    if (res.count === 0) throw new ConflictException('Only DRAFT or SCHEDULED announcements can be cancelled');
    await this.auditLog(actor, 'CANCEL', id, {});
    return this.findOne(id);
  }

  /** Manual send now. Atomic claim -> 409 on double send. */
  async send(id: string, actor: AuthUser) {
    await this.findOne(id);
    const claimed = await this.claimAndEnqueue(id);
    if (!claimed) throw new ConflictException('Announcement is not sendable (already sending, sent or cancelled)');
    await this.auditLog(actor, 'SEND', id, {});
    return this.findOne(id);
  }

  /** Atomic DRAFT/SCHEDULED/FAILED -> SENDING claim; enqueues dispatch only if the claim won. */
  async claimAndEnqueue(id: string, extraWhere: Prisma.AnnouncementWhereInput = {}): Promise<boolean> {
    const prev = await this.prisma.announcement.findUnique({ where: { id }, select: { status: true } });
    const res = await this.prisma.announcement.updateMany({
      where: { id, status: { in: SENDABLE }, ...extraWhere },
      data: { status: AnnouncementStatus.SENDING, lastError: null },
    });
    if (res.count === 0) return false;
    try {
      await this.enqueueDispatch(id);
    } catch (err) {
      // Queue unavailable: release the claim so it can be retried / picked up by the scan.
      await this.prisma.announcement.updateMany({
        where: { id, status: AnnouncementStatus.SENDING },
        data: { status: prev?.status ?? AnnouncementStatus.DRAFT, lastError: 'Failed to enqueue dispatch' },
      });
      throw err;
    }
    return true;
  }

  enqueueDispatch(id: string) {
    return this.queue.add(
      JOB_NAMES.DISPATCH_ANNOUNCEMENT,
      { id },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 50, removeOnFail: 50 },
    );
  }

  /** Scheduler tick: claim+enqueue due SCHEDULED announcements; re-enqueue orphaned SENDING ones. */
  async scanDue(now = new Date()): Promise<{ dispatched: number; resumed: number }> {
    const due = await this.prisma.announcement.findMany({
      where: { status: AnnouncementStatus.SCHEDULED, scheduledFor: { lte: now } },
      select: { id: true },
      take: 100,
    });
    let dispatched = 0;
    for (const { id } of due) {
      try {
        if (await this.claimAndEnqueue(id, { scheduledFor: { lte: now } })) dispatched++;
      } catch (err) {
        this.logger.error(`Failed to dispatch due announcement ${id}: ${(err as Error).message}`);
      }
    }

    const stale = await this.prisma.announcement.findMany({
      where: { status: AnnouncementStatus.SENDING, updatedAt: { lte: new Date(now.getTime() - SENDING_STALE_MS) } },
      select: { id: true },
      take: 100,
    });
    let resumed = 0;
    for (const { id } of stale) {
      try {
        await this.prisma.announcement.update({ where: { id }, data: { lastError: 'Resumed after stall' } });
        await this.enqueueDispatch(id);
        resumed++;
      } catch (err) {
        this.logger.error(`Failed to resume announcement ${id}: ${(err as Error).message}`);
      }
    }
    return { dispatched, resumed };
  }

  async stats(id: string) {
    const a = await this.findOne(id);
    const rows = await this.prisma.inAppNotification.groupBy({
      by: ['vendorId', 'isRead'],
      where: { type: 'PLATFORM_ANNOUNCEMENT', entityId: id },
      _count: { _all: true },
    });
    const byVendorMap = new Map<string, { delivered: number; read: number }>();
    let delivered = 0;
    let read = 0;
    for (const r of rows) {
      const n = r._count._all;
      delivered += n;
      if (r.isRead) read += n;
      if (!r.vendorId) continue;
      const cur = byVendorMap.get(r.vendorId) ?? { delivered: 0, read: 0 };
      cur.delivered += n;
      if (r.isRead) cur.read += n;
      byVendorMap.set(r.vendorId, cur);
    }
    const vendors = byVendorMap.size
      ? await this.prisma.vendor.findMany({
          where: { id: { in: [...byVendorMap.keys()] } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(vendors.map((v) => [v.id, v.name]));
    const byVendor = [...byVendorMap.entries()]
      .map(([vendorId, v]) => ({ vendorId, name: names.get(vendorId) ?? vendorId, ...v }))
      .sort((x, y) => x.name.localeCompare(y.name));
    return {
      status: a.status,
      recipientCount: a.recipientCount,
      delivered,
      read,
      readRate: delivered > 0 ? Math.round((read / delivered) * 1000) / 1000 : 0,
      byVendor,
    };
  }

  // ───────────── helpers ─────────────

  private async validateTargets(audience: AnnouncementAudience, vendorIds?: string[]): Promise<string[]> {
    if (audience === AnnouncementAudience.ALL_VENDORS) return [];
    const unique = [...new Set(vendorIds ?? [])];
    if (unique.length === 0) throw new BadRequestException('SELECTED_VENDORS requires at least one vendorId');
    const found = await this.prisma.vendor.count({ where: { id: { in: unique } } });
    if (found !== unique.length) throw new BadRequestException('One or more vendorIds do not exist');
    return unique;
  }

  private parseFuture(iso?: string | null): Date | undefined {
    if (!iso) return undefined;
    const d = new Date(iso);
    if (isNaN(d.getTime())) throw new BadRequestException('scheduledFor is not a valid date');
    if (d.getTime() <= Date.now()) throw new BadRequestException('scheduledFor must be in the future');
    return d;
  }

  private auditLog(actor: AuthUser, action: string, id: string, changes: { before?: any; after?: any }) {
    return this.audit.log({
      userId: actor.userId,
      userName: actor.name,
      action,
      entity: 'Announcement',
      entityId: id,
      changes,
    });
  }
}
