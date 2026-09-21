import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthUser } from '@water-supply-crm/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { ExtraLabourService } from './extra-labour.service';
import { ExtraLabourTypeService } from './extra-labour-type.service';
import { CreateExtraLabourDto } from './dto/create-extra-labour.dto';
import { UpdateExtraLabourDto } from './dto/update-extra-labour.dto';
import { CreateLabourTypeDto } from './dto/create-labour-type.dto';
import { UpdateLabourTypeDto } from './dto/update-labour-type.dto';
import { ExtraLabourQueryDto } from './dto/extra-labour-query.dto';
import { ExtraLabourPaymentsQueryDto } from './dto/extra-labour-payments-query.dto';

@Controller('extra-labour')
export class ExtraLabourController {
  constructor(
    private readonly extraLabour: ExtraLabourService,
    private readonly types: ExtraLabourTypeService,
  ) {}

  // ── Static routes BEFORE parameterised /:id routes ─────────────────────────

  @Get('options')
  @RequireAnyPermission('extra_labour:view', 'expenses:create')
  getOptions(
    @CurrentUser() user: AuthUser,
    @Query('search') search?: string,
    @Query('includeId') includeId?: string,
  ) {
    return this.extraLabour.getOptions(user.vendorId, search, includeId);
  }

  @Get('summary')
  @RequirePermissions('extra_labour:view')
  getSummary(@CurrentUser() user: AuthUser) {
    return this.extraLabour.getSummary(user.vendorId);
  }

  @Get('types')
  @RequireAnyPermission('extra_labour:view', 'extra_labour:create')
  getTypes(@CurrentUser() user: AuthUser) {
    return this.types.listTypes(user.vendorId);
  }

  @Post('types')
  @RequirePermissions('extra_labour:manage')
  createType(@CurrentUser() user: AuthUser, @Body() dto: CreateLabourTypeDto) {
    return this.types.createType(user, dto);
  }

  @Patch('types/:id')
  @RequirePermissions('extra_labour:manage')
  updateType(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateLabourTypeDto,
  ) {
    return this.types.updateType(user, id, dto);
  }

  @Delete('types/:id')
  @RequirePermissions('extra_labour:manage')
  deleteType(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.types.deleteType(user, id);
  }

  @Get()
  @RequirePermissions('extra_labour:view')
  listLabourers(
    @CurrentUser() user: AuthUser,
    @Query() query: ExtraLabourQueryDto,
  ) {
    return this.extraLabour.listLabourers(user.vendorId, query);
  }

  @Post()
  @RequirePermissions('extra_labour:create')
  createLabourer(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateExtraLabourDto,
  ) {
    return this.extraLabour.createLabourer(user, dto);
  }

  // ── Parameterised /:id routes ─────────────────────────────────────────────

  @Get(':id')
  @RequirePermissions('extra_labour:view')
  getLabourerProfile(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.extraLabour.getLabourerProfile(user.vendorId, id);
  }

  @Patch(':id')
  @RequirePermissions('extra_labour:manage')
  updateLabourer(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateExtraLabourDto,
  ) {
    return this.extraLabour.updateLabourer(user, id, dto);
  }

  @Get(':id/payments')
  @RequirePermissions('extra_labour:view')
  getLabourerPayments(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: ExtraLabourPaymentsQueryDto,
  ) {
    return this.extraLabour.getLabourerPayments(user.vendorId, id, query);
  }
}
