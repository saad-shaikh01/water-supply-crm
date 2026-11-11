import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuditModule } from '../audit/audit.module';
import { PlatformAuditController } from './platform-audit.controller';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformHealthController } from './platform-health.controller';
import { PLATFORM_REDIS, PlatformHealthService, redisClientFactory } from './platform-health.service';
import { PlatformImportsController } from './platform-imports.controller';
import { PlatformImportsService } from './platform-imports.service';
import { bullQueueRegistrations, platformQueuesProvider } from './queue-registry';

/**
 * Super-admin observability: audit logs, system health, import monitor.
 * (WhatsApp accounts live on PlatformWhatsAppController in the whatsapp module.)
 * BullModule.forRoot is in SharedQueueModule (libs/shared/queue); queues are re-registered here read-only.
 */
@Module({
  imports: [AuditModule, BullModule.registerQueue(...bullQueueRegistrations)],
  controllers: [PlatformAuditController, PlatformHealthController, PlatformImportsController],
  providers: [
    PlatformAuditService,
    PlatformHealthService,
    PlatformImportsService,
    platformQueuesProvider,
    { provide: PLATFORM_REDIS, useFactory: redisClientFactory },
  ],
})
export class PlatformObservabilityModule {}
