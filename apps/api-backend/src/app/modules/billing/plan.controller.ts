import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@water-supply-crm/types';
import { RequireSuperAdmin } from '../../common/decorators/authz-markers.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlanService } from './plan.service';
import { CreatePlanDto, ListPlansQueryDto, UpdatePlanDto } from './dto/plan.dto';

// Platform surface — super-admin only.
@Controller('platform/plans')
@RequireSuperAdmin()
export class PlanController {
  constructor(private readonly plans: PlanService) {}

  @Get()
  findAll(@Query() query: ListPlansQueryDto) {
    return this.plans.findAll(query.includeInactive);
  }

  @Post()
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePlanDto) {
    return this.plans.create(dto, user);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlanDto) {
    return this.plans.update(id, dto, user);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.plans.remove(id, user);
  }
}
