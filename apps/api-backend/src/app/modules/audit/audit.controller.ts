import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuditService } from './audit.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

@Controller('audit-logs')
@RequirePermissions('audit_logs:view')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query() query: AuditLogQueryDto) {
    // SUPER_ADMIN sees all; VENDOR_ADMIN sees only their vendor.
    const vendorId = user.role === UserRole.SUPER_ADMIN ? null : user.vendorId;
    return this.auditService.findAll(vendorId, query);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const log = await this.auditService.findOne(id);
    if (!log) throw new NotFoundException('Audit log not found');
    return log;
  }
}
