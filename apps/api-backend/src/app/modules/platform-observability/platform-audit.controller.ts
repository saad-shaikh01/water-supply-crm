import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { AuthUser } from '@water-supply-crm/types';
import { RequireSuperAdmin } from '../../common/decorators/authz-markers.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformAuditQueryDto } from './dto/platform-audit-query.dto';

@Controller('platform/audit-logs')
@RequireSuperAdmin()
export class PlatformAuditController {
  constructor(
    private readonly service: PlatformAuditService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Query() query: PlatformAuditQueryDto) {
    return this.service.findAll(query);
  }

  @Get('facets')
  facets() {
    return this.service.facets();
  }

  @Get('export.csv')
  @Throttle({ medium: { ttl: 60000, limit: 3 } })
  async exportCsv(@CurrentUser() user: AuthUser, @Query() query: PlatformAuditQueryDto, @Res() res: Response) {
    const { where, truncated } = await this.service.prepareExport(query);
    res.status(200);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit-logs-${new Date().toISOString().slice(0, 10)}.csv"`,
      'X-Export-Truncated': String(truncated),
      'Cache-Control': 'no-store',
    });
    const counter = { rows: 0 };
    try {
      for await (const chunk of this.service.exportChunks(where, counter)) res.write(chunk);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { page: _p, limit: _l, ...filters } = query;
      await this.audit.log({
        userId: user.userId,
        userName: user.name,
        action: 'EXPORT',
        entity: 'AuditLog',
        changes: { after: { filters, rowCount: counter.rows, truncated } },
      });
      res.end();
    }
  }

  @Get(':id')
  async findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    const row = await this.service.findOne(id);
    if (!row) throw new NotFoundException('Audit log not found');
    return row;
  }
}
