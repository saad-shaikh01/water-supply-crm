import { Controller, Get, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RequireSuperAdmin } from '../../common/decorators/authz-markers.decorator';
import { PlatformHealthService } from './platform-health.service';
import { FailedJobsQueryDto, HealthQueryDto } from './dto/platform-health-query.dto';

@Controller('platform/health')
@RequireSuperAdmin()
export class PlatformHealthController {
  constructor(private readonly service: PlatformHealthService) {}

  @Get()
  get(@Query() q: HealthQueryDto) {
    return this.service.getHealth(q.refresh === 'true');
  }

  @Get('queues/:name/failed')
  @Throttle({ medium: { ttl: 60000, limit: 20 } })
  failed(@Param('name') name: string, @Query() q: FailedJobsQueryDto) {
    return this.service.getFailedJobs(name, q.limit ?? 10);
  }
}
