import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { DeliveryIssueStatus, IssueNextAction, IssueResolution } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { paginate } from '../../common/helpers/paginate';
import { DeliveryIssueQueryDto } from './dto/delivery-issue-query.dto';
import { PlanIssueDto } from './dto/plan-issue.dto';
import { ResolveIssueDto } from './dto/resolve-issue.dto';
import { BulkScheduleIssuesDto } from './dto/bulk-schedule-issues.dto';
import { BulkResolveIssuesDto } from './dto/bulk-resolve-issues.dto';
import { DailySheetService } from '../daily-sheet/daily-sheet.service';
import { PermissionService } from '../authz/permission.service';

const ISSUE_INCLUDE = {
  dailySheetItem: {
    select: {
      id: true,
      sequence: true,
      status: true,
      failureCategory: true,
      reason: true,
      customer: { select: { id: true, name: true, customerCode: true, address: true } },
      product: { select: { id: true, name: true } },
      dailySheet: {
        select: {
          id: true,
          date: true,
          route: { select: { id: true, name: true } },
          van: { select: { id: true, plateNumber: true } },
          driver: { select: { id: true, name: true } },
        },
      },
    },
  },
} as const;

// Which planning intents represent an actual reschedule (Phase 2/3) — only
// these ever trigger a real moveDeliveryItems() call. SELF_PICKUP,
// CANCEL_ONE_OFF and PERMANENT_STOP are terminal-ish intents; a stray
// leftover retryAt/assignedVanId from a PREVIOUS plan edit (the dialog
// prefills its form from the issue's existing values) must never
// accidentally move the customer just because those fields still have values.
const SCHEDULING_ACTIONS: ReadonlySet<IssueNextAction> = new Set([
  IssueNextAction.RETRY_SAME_DAY,
  IssueNextAction.RETRY_ON_DATE_TIME,
  IssueNextAction.MOVE_TO_NEXT_REGULAR_DAY,
]);

/** YYYY-MM-DD in the vendor's operating timezone (same Asia/Karachi convention
 * DailySheetService already uses for deliveryTime) — 'en-CA' formats as
 * YYYY-MM-DD, which is exactly what moveDeliveryItems()'s @IsDateString()
 * destinationDate expects. */
function toVendorDateString(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
}

@Injectable()
export class DeliveryIssueService {
  constructor(
    private prisma: PrismaService,
    // Circular DI with DailySheetService (see delivery-issue.module.ts) —
    // Phase 2/3 reuse DailySheetService.moveDeliveryItems() directly instead
    // of duplicating the sheet-move/creation logic.
    @Inject(forwardRef(() => DailySheetService))
    private dailySheetService: DailySheetService,
    private permissions: PermissionService,
  ) {}

  async findAll(vendorId: string, query: DeliveryIssueQueryDto) {
    const {
      page = 1,
      limit = 20,
      status,
      sheetId,
      assignedToUserId,
      vanId,
      dateFrom,
      dateTo,
    } = query;

    const where: any = { vendorId };
    if (status) where.status = status;
    if (sheetId) {
      where.dailySheetItem = { dailySheetId: sheetId };
    }
    if (assignedToUserId) {
      where.assignedToUserId = assignedToUserId;
    }
    // Origin van (Phase 1) — reuses the existing dailySheetItem.dailySheet.van
    // relation already joined for the "Route / Van" column; no new field.
    // Merged onto the same nested `where.dailySheetItem.dailySheet` object the
    // date filter below also writes to, so both can be active together.
    if (vanId || dateFrom || dateTo) {
      if (!where.dailySheetItem) where.dailySheetItem = {};
      where.dailySheetItem.dailySheet = {};
      if (vanId) {
        where.dailySheetItem.dailySheet.vanId = vanId;
      }
      if (dateFrom || dateTo) {
        const dateFilter: any = {};
        if (dateFrom) dateFilter.gte = new Date(dateFrom);
        if (dateTo) {
          const endOfDay = new Date(dateTo);
          endOfDay.setHours(23, 59, 59, 999);
          dateFilter.lte = endOfDay;
        }
        where.dailySheetItem.dailySheet.date = dateFilter;
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.deliveryIssue.findMany({
        where,
        include: ISSUE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.deliveryIssue.count({ where }),
    ]);

    return paginate(data, total, page, limit);
  }

  async findOne(vendorId: string, id: string) {
    const issue = await this.prisma.deliveryIssue.findFirst({
      where: { id, vendorId },
      include: ISSUE_INCLUDE,
    });
    if (!issue) throw new NotFoundException('Delivery issue not found');
    return issue;
  }

  /**
   * Delivery Issues Phase 2 — "Plan" now performs a REAL schedule when the
   * chosen next action is a reschedule one and both a retry date and a van
   * were given: it moves the underlying DailySheetItem to that van's sheet
   * for that date (creating the sheet if needed) via the exact same
   * DailySheetService.moveDeliveryItems() the Daily Sheet page's own "Move"
   * button uses — same audit trail, same DeliveryItemMoveLog, same
   * conflict/closed-sheet guards. No separate scheduling logic here.
   *
   * When no reschedule is requested (e.g. SELF_PICKUP / CANCEL_ONE_OFF /
   * PERMANENT_STOP, or a reschedule action with no van picked yet), behavior
   * is unchanged from before Phase 2: metadata-only.
   */
  async plan(vendorId: string, id: string, dto: PlanIssueDto, user: AuthUser) {
    const issue = await this.prisma.deliveryIssue.findFirst({
      where: { id, vendorId },
    });
    if (!issue) throw new NotFoundException('Delivery issue not found');
    if (issue.status === DeliveryIssueStatus.RESOLVED || issue.status === DeliveryIssueStatus.DROPPED) {
      throw new BadRequestException(`Cannot plan an issue with status ${issue.status}`);
    }

    const wantsSchedule =
      SCHEDULING_ACTIONS.has(dto.nextAction) && !!dto.retryAt && !!dto.assignedVanId;

    if (wantsSchedule) {
      // daily_sheets:move_customer is independently grantable from
      // delivery_issues:plan (Amendment R10) — a role holding only the latter
      // can still submit a plan, just never one that requests an actual move.
      const canMove = await this.permissions.can(user.userId, 'daily_sheets:move_customer');
      if (!canMove) {
        throw new ForbiddenException('You do not have permission to schedule a delivery move.');
      }

      await this.dailySheetService.moveDeliveryItems(user, {
        itemIds: [issue.dailySheetItemId],
        destinationVanId: dto.assignedVanId!,
        // retryAt arrives as a full UTC ISO instant (the frontend's
        // datetime-local input converted via toISOString()) — slicing that
        // string's first 10 chars would silently shift to the PREVIOUS
        // calendar day for any early-morning local time in a timezone ahead
        // of UTC (Asia/Karachi is +5). Re-derive the calendar date in the
        // vendor's operating timezone instead, matching the same
        // Asia/Karachi convention used for deliveryTime elsewhere in
        // DailySheetService.
        destinationDate: toVendorDateString(new Date(dto.retryAt!)),
        note: dto.notes,
      });
    }

    const nextStatus = wantsSchedule
      ? DeliveryIssueStatus.PLANNED
      : issue.status === DeliveryIssueStatus.OPEN
        ? DeliveryIssueStatus.PLANNED
        : issue.status;

    return this.prisma.deliveryIssue.update({
      where: { id },
      data: {
        status: nextStatus,
        nextAction: dto.nextAction,
        retryAt: dto.retryAt ? new Date(dto.retryAt) : undefined,
        assignedToUserId: dto.assignedToUserId ?? null,
        assignedVanId: dto.assignedVanId ?? null,
        assignedDriverId: dto.assignedDriverId ?? null,
        planNotes: dto.notes ?? null,
        plannedAt: new Date(),
        plannedById: user.userId,
      },
      include: ISSUE_INCLUDE,
    });
  }

  async resolve(vendorId: string, id: string, dto: ResolveIssueDto, resolvedById: string) {
    const issue = await this.prisma.deliveryIssue.findFirst({
      where: { id, vendorId },
    });
    if (!issue) throw new NotFoundException('Delivery issue not found');
    if (issue.status === DeliveryIssueStatus.RESOLVED || issue.status === DeliveryIssueStatus.DROPPED) {
      throw new BadRequestException(`Issue is already ${issue.status}`);
    }

    return this.prisma.deliveryIssue.update({
      where: { id },
      data: {
        status: DeliveryIssueStatus.RESOLVED,
        resolution: dto.resolution,
        resolvedNotes: dto.notes ?? null,
        resolvedAt: new Date(),
        resolvedById,
      },
      include: ISSUE_INCLUDE,
    });
  }

  async createForItem(vendorId: string, dailySheetItemId: string) {
    const existing = await this.prisma.deliveryIssue.findUnique({
      where: { dailySheetItemId },
    });
    if (existing) return existing;

    return this.prisma.deliveryIssue.create({
      data: {
        vendorId,
        dailySheetItemId,
        status: DeliveryIssueStatus.OPEN,
      },
    });
  }

  /**
   * Delivery Issues Phase 5 — closes the loop when a retried delivery (same
   * DailySheetItem id, possibly after a Plan/Bulk-Schedule move) actually
   * completes. Single indexed lookup by the unique dailySheetItemId, so an
   * ordinary completed delivery that never had an issue is a no-op — normal
   * deliveries are entirely unaffected. Reuses resolve() itself: identical
   * audit fields (resolvedById/resolvedAt/resolution/resolvedNotes) to a
   * manual resolve from the Delivery Issues page.
   */
  async autoResolveOnSuccess(vendorId: string, dailySheetItemId: string, resolvedById: string): Promise<void> {
    const issue = await this.prisma.deliveryIssue.findUnique({ where: { dailySheetItemId } });
    if (!issue || issue.vendorId !== vendorId) return;
    if (issue.status === DeliveryIssueStatus.RESOLVED || issue.status === DeliveryIssueStatus.DROPPED) return;

    await this.resolve(
      vendorId,
      issue.id,
      { resolution: IssueResolution.RETRY_SUCCESS, notes: 'Auto-resolved — retry delivery completed successfully.' },
      resolvedById,
    );
  }

  /**
   * Delivery Issues Phase 3 — bulk entry point into the exact same
   * moveDeliveryItems() the single Plan action (Phase 2) and the Daily Sheet
   * page's Move dialog both use. All-or-nothing: moveDeliveryItems() throws
   * on the first invalid item in the batch (wrong status, destination
   * conflict, closed sheet) and nothing moves or updates — same existing
   * transactional behavior, not changed here.
   */
  async bulkSchedule(vendorId: string, dto: BulkScheduleIssuesDto, user: AuthUser) {
    const issues = await this.prisma.deliveryIssue.findMany({
      where: { id: { in: dto.issueIds }, vendorId },
    });
    if (issues.length !== dto.issueIds.length) {
      throw new NotFoundException('One or more delivery issues not found');
    }
    const alreadyClosed = issues.filter(
      (i) => i.status === DeliveryIssueStatus.RESOLVED || i.status === DeliveryIssueStatus.DROPPED,
    );
    if (alreadyClosed.length > 0) {
      throw new BadRequestException(
        `${alreadyClosed.length} of the selected issues are already resolved/dropped and cannot be scheduled`,
      );
    }

    const moveResult = await this.dailySheetService.moveDeliveryItems(user, {
      itemIds: issues.map((i) => i.dailySheetItemId),
      destinationVanId: dto.destinationVanId,
      destinationDate: dto.destinationDate,
      note: dto.notes,
    });

    const now = new Date();
    await this.prisma.deliveryIssue.updateMany({
      where: { id: { in: dto.issueIds } },
      data: {
        status: DeliveryIssueStatus.PLANNED,
        nextAction: IssueNextAction.RETRY_ON_DATE_TIME,
        retryAt: new Date(dto.destinationDate),
        assignedVanId: dto.destinationVanId,
        planNotes: dto.notes ?? null,
        plannedAt: now,
        plannedById: user.userId,
      },
    });

    return { ...moveResult, issuesUpdated: issues.length };
  }

  /**
   * Delivery Issues Phase 4 — loops the existing single resolve() per id.
   * Partial success by design (unlike bulkSchedule's all-or-nothing): each
   * resolve() is an independent single-row update with no shared side effects
   * across issues, so one issue already resolved by someone else shouldn't
   * block resolving the rest of the batch.
   */
  async bulkResolve(vendorId: string, dto: BulkResolveIssuesDto, resolvedById: string) {
    const results: Array<{ id: string; success: boolean; message?: string }> = [];
    for (const id of dto.ids) {
      try {
        await this.resolve(vendorId, id, { resolution: dto.resolution, notes: dto.notes }, resolvedById);
        results.push({ id, success: true });
      } catch (e: any) {
        results.push({ id, success: false, message: e?.message ?? 'Failed to resolve' });
      }
    }
    return {
      results,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    };
  }
}
