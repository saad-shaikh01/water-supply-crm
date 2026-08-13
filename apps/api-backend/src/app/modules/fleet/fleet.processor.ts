import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';
import { FleetNotificationService } from './fleet-notification.service';

@Processor(QUEUE_NAMES.FLEET_NOTIFICATIONS)
export class FleetProcessor extends WorkerHost {
  private readonly logger = new Logger(FleetProcessor.name);

  constructor(private fleetNotifications: FleetNotificationService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === JOB_NAMES.FLEET_NOTIFICATION_SWEEP) {
      return this.fleetNotifications.sweepAllVendors();
    }
    this.logger.warn(`Unknown Fleet job: ${job.name}`);
  }
}
