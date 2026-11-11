import { getQueueToken } from '@nestjs/bullmq';
import type { Provider } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES } from '@water-supply-crm/queue';

/** Whitelist of every BullMQ queue the platform health page may inspect. */
export const OBSERVED_QUEUE_NAMES: string[] = Object.values(QUEUE_NAMES);

export const PLATFORM_QUEUES = 'PLATFORM_OBSERVED_QUEUES';

export const bullQueueRegistrations = OBSERVED_QUEUE_NAMES.map((name) => ({ name }));

/** Provides a name -> Queue map built from the registered queue tokens. */
export const platformQueuesProvider: Provider = {
  provide: PLATFORM_QUEUES,
  useFactory: (...queues: Queue[]) => new Map(OBSERVED_QUEUE_NAMES.map((n, i) => [n, queues[i]])),
  inject: OBSERVED_QUEUE_NAMES.map((n) => getQueueToken(n)),
};
