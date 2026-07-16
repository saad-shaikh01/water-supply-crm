import { Controller, Get, Patch, Body, Query } from '@nestjs/common';
import { CollectionPolicyService } from './collection-policy.service';
import { UpdateCollectionPolicyDto } from './dto/update-collection-policy.dto';
import { UpdateCashCollectionPolicyDto } from './dto/update-cash-collection-policy.dto';
import { CashCollectionPolicyImpactQueryDto } from './dto/cash-collection-policy-impact-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * Vendor-level Collection Policy config — Monthly (minimum-collection floor)
 * and Cash (proportional-settlement credit control), both enforced inside
 * DailySheetService.submitDelivery. Distinct from that enforcement: this
 * controller only reads/writes the configured thresholds.
 */
@Controller('collection-policy')
export class CollectionPolicyController {
  constructor(private readonly collectionPolicy: CollectionPolicyService) {}

  /** GET /collection-policy — current Monthly config (defaults if unset). */
  @Get()
  @RequirePermissions('collection_policy:view')
  getPolicy(@CurrentUser() user: AuthUser) {
    return this.collectionPolicy.getPolicy(user.vendorId);
  }

  /** PATCH /collection-policy — upsert Monthly config. */
  @Patch()
  @RequirePermissions('collection_policy:update')
  updatePolicy(@CurrentUser() user: AuthUser, @Body() dto: UpdateCollectionPolicyDto) {
    return this.collectionPolicy.updatePolicy(user.vendorId, dto);
  }

  /** GET /collection-policy/cash — current Cash config (defaults if unset). */
  @Get('cash')
  @RequirePermissions('collection_policy:view')
  getCashPolicy(@CurrentUser() user: AuthUser) {
    return this.collectionPolicy.getCashPolicy(user.vendorId);
  }

  /** PATCH /collection-policy/cash — upsert Cash config. */
  @Patch('cash')
  @RequirePermissions('collection_policy:update')
  updateCashPolicy(@CurrentUser() user: AuthUser, @Body() dto: UpdateCashCollectionPolicyDto) {
    return this.collectionPolicy.updateCashPolicy(user.vendorId, dto);
  }

  /**
   * GET /collection-policy/cash/impact — read-only rollout-guard preview
   * (§8.1, §12, §21.1) for PROSPECTIVE settings, not the saved config.
   */
  @Get('cash/impact')
  @RequirePermissions('collection_policy:update')
  getCashPolicyImpact(@CurrentUser() user: AuthUser, @Query() query: CashCollectionPolicyImpactQueryDto) {
    return this.collectionPolicy.getCashPolicyImpact(user.vendorId, query);
  }
}
