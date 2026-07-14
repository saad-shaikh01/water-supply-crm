import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CollectionPolicyService } from './collection-policy.service';
import { UpdateCollectionPolicyDto } from './dto/update-collection-policy.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * Vendor-level Monthly Customer Collection Policy config — the minimum-collection
 * floor enforced inside DailySheetService.submitDelivery. Distinct from that
 * enforcement: this controller only reads/writes the configured thresholds.
 */
@Controller('collection-policy')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CollectionPolicyController {
  constructor(private readonly collectionPolicy: CollectionPolicyService) {}

  /** GET /collection-policy — current config (defaults if unset). */
  @Get()
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
  getPolicy(@CurrentUser() user: AuthUser) {
    return this.collectionPolicy.getPolicy(user.vendorId);
  }

  /** PATCH /collection-policy — upsert config. */
  @Patch()
  @Roles(UserRole.VENDOR_ADMIN)
  updatePolicy(@CurrentUser() user: AuthUser, @Body() dto: UpdateCollectionPolicyDto) {
    return this.collectionPolicy.updatePolicy(user.vendorId, dto);
  }
}
