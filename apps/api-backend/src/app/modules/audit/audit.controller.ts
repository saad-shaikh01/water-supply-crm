import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuditService } from './audit.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.VENDOR_ADMIN)
  findAll(@CurrentUser() user: any, @Query() query: AuditLogQueryDto) {
    // SUPER_ADMIN sees all; VENDOR_ADMIN sees only their vendor
    const vendorId = user.role === UserRole.SUPER_ADMIN ? null : user.vendorId;
    return this.auditService.findAll(vendorId, query);
  }

  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.VENDOR_ADMIN)
  async findOne(@Param('id') id: string) {
    const log = await this.auditService.findOne(id);
    if (!log) throw new NotFoundException('Audit log not found');
    return log;
  }
}
