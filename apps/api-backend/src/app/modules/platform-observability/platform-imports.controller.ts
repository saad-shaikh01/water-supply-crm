import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { RequireSuperAdmin } from '../../common/decorators/authz-markers.decorator';
import { PlatformImportsService } from './platform-imports.service';
import { PlatformImportsQueryDto } from './dto/platform-imports-query.dto';

@Controller('platform/imports')
@RequireSuperAdmin()
export class PlatformImportsController {
  constructor(private readonly service: PlatformImportsService) {}

  @Get()
  list(@Query() q: PlatformImportsQueryDto) {
    return this.service.list(q);
  }

  @Get('stats')
  stats() {
    return this.service.stats();
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.findOne(id);
  }
}
