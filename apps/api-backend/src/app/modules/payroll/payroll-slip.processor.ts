import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { JOB_NAMES, QUEUE_NAMES } from '@water-supply-crm/queue';
import { PayrollSlipService } from './payroll-slip.service';

export interface PayrollSlipJobData {
  dispatchId: string;
  vendorId: string;
}

/**
 * Sends a salary-slip dispatch. All the work (connectivity check, randomized delay, per-employee result
 * rows) lives in `PayrollSlipService.runDispatch`; this class is only the queue binding.
 */
@Processor(QUEUE_NAMES.PAYROLL_SLIP_SEND)
export class PayrollSlipProcessor extends WorkerHost {
  private readonly logger = new Logger(PayrollSlipProcessor.name);

  constructor(private readonly slips: PayrollSlipService) {
    super();
  }

  async process(job: Job<PayrollSlipJobData>): Promise<void> {
    if (job.name !== JOB_NAMES.SEND_PAYROLL_SLIPS) return;
    this.logger.log(`Processing salary-slip dispatch ${job.data.dispatchId} (vendor ${job.data.vendorId})`);
    await this.slips.runDispatch(job.data.dispatchId);
  }
}
