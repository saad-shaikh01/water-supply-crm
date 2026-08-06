import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { StaffLedgerService } from './staff-ledger.service';
import { CreateStaffLedgerEntryDto } from './dto/create-staff-ledger-entry.dto';
import { ApproveStaffLedgerEntryDto } from './dto/approve-staff-ledger-entry.dto';
import { VoidStaffLedgerEntryDto } from './dto/void-staff-ledger-entry.dto';
import { ReverseStaffLedgerEntryDto } from './dto/reverse-staff-ledger-entry.dto';
import { CorrectStaffLedgerEntryDto } from './dto/correct-staff-ledger-entry.dto';
import { LedgerEntryQueryDto } from './dto/ledger-entry-query.dto';
import { AuthenticatedOnly } from '../../common/decorators/authz-markers.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * Append-only staff financial ledger. Fine-grained payroll:* permissions
 * (rbac-permission-catalog.md §27), replacing the interim
 * `@RequireRoles(VENDOR_ADMIN, STAFF)` gate:
 *   - create        → payroll:ledger_create   (VENDOR_ADMIN, STAFF by preset)
 *   - approve        → payroll:ledger_approve  (VENDOR_ADMIN by preset; STAFF only
 *                       via an explicit UserPermissionOverride, per §10)
 *   - voidEntry      → NOT gated by a hard `@RequirePermissions` — voidable by
 *                       either payroll:ledger_void (VENDOR_ADMIN by preset) OR
 *                       the entry's own creator, and a route decorator can only
 *                       express one fixed rule, not an "OR the caller who made
 *                       this specific row" exception. So the route stays
 *                       `@AuthenticatedOnly()` and the actual decision — permission
 *                       check OR createdById match — lives entirely inside
 *                       `StaffLedgerService.voidEntry` (see its doc comment).
 *   - reverse/correct → payroll:ledger_reverse / payroll:ledger_correct
 *                       (VENDOR_ADMIN only — same tier, reverse+create under the
 *                       hood)
 *
 * findForEmployee stays `@AuthenticatedOnly()`: every role may read its OWN
 * ledger with no permission at all, and viewing another employee's requires
 * `payroll:view_all` — that self-scoping is a code-level check inside
 * `StaffLedgerService.findForEmployee` (see
 * `common/helpers/payroll-view-scope.util.ts`), not expressible as a route
 * decorator since "my own record" depends on the request's own target id.
 *
 * NOTE: markers are applied per-method, not at the class level. The single
 * global PermissionsGuard resolves each metadata KEY independently via
 * `Reflector.getAllAndOverride`, so a class-level `@AuthenticatedOnly()`
 * would still satisfy the AUTHENTICATED_ONLY_KEY check (and short-circuit
 * before PERMISSIONS_KEY is ever read) even on methods carrying their own
 * `@RequirePermissions()` — the two decorators don't "layer", the more
 * permissive one wins if both are reachable. `voidEntry` and
 * `findForEmployee` therefore carry ONLY `@AuthenticatedOnly()`; every other
 * mutation carries ONLY `@RequirePermissions(...)`.
 */
@Controller('payroll/ledger-entries')
export class StaffLedgerController {
  constructor(private readonly staffLedger: StaffLedgerService) {}

  /** POST /payroll/ledger-entries — create (PENDING or POSTED per approval gate). */
  @Post()
  @RequirePermissions('payroll:ledger_create')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateStaffLedgerEntryDto) {
    return this.staffLedger.create(user, dto);
  }

  /** GET /payroll/ledger-entries/employee/:userId — financial timeline. */
  @Get('employee/:userId')
  @AuthenticatedOnly()
  findForEmployee(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Query() query: LedgerEntryQueryDto,
  ) {
    return this.staffLedger.findForEmployee(user, userId, query);
  }

  /** PATCH /payroll/ledger-entries/:id/approve — PENDING -> POSTED. */
  @Patch(':id/approve')
  @RequirePermissions('payroll:ledger_approve')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ApproveStaffLedgerEntryDto) {
    return this.staffLedger.approve(user, id, dto);
  }

  /**
   * PATCH /payroll/ledger-entries/:id/void — PENDING or pre-lock POSTED -> VOIDED.
   * Open to any authenticated user — `StaffLedgerService.voidEntry` enforces
   * "payroll:ledger_void OR the entry's own creator" as a code-level check.
   */
  @Patch(':id/void')
  @AuthenticatedOnly()
  voidEntry(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: VoidStaffLedgerEntryDto) {
    return this.staffLedger.voidEntry(user, id, dto);
  }

  /** POST /payroll/ledger-entries/:id/reverse — post-lock POSTED -> new opposite-sign REVERSAL entry. */
  @Post(':id/reverse')
  @RequirePermissions('payroll:ledger_reverse')
  reverse(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReverseStaffLedgerEntryDto) {
    return this.staffLedger.reverse(user, id, dto);
  }

  /** POST /payroll/ledger-entries/:id/correct — post-lock POSTED -> REVERSAL + fresh CORRECTION entry. */
  @Post(':id/correct')
  @RequirePermissions('payroll:ledger_correct')
  correct(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CorrectStaffLedgerEntryDto) {
    return this.staffLedger.correct(user, id, dto);
  }
}
