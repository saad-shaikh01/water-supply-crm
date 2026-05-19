import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { DeliveryIssueService } from './delivery-issue.service';
import { DeliveryIssueQueryDto } from './dto/delivery-issue-query.dto';
import { PlanIssueDto } from './dto/plan-issue.dto';
import { ResolveIssueDto } from './dto/resolve-issue.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('delivery-issues')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF)
export class DeliveryIssueController {
  constructor(private readonly issueService: DeliveryIssueService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query() query: DeliveryIssueQueryDto) {
    return this.issueService.findAll(user.vendorId, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.issueService.findOne(user.vendorId, id);
  }

  @Patch(':id/plan')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  plan(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PlanIssueDto,
  ) {
    return this.issueService.plan(user.vendorId, id, dto, user.userId);
  }

  @Patch(':id/resolve')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveIssueDto,
  ) {
    return this.issueService.resolve(user.vendorId, id, dto, user.userId);
  }
}
