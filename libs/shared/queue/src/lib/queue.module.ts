import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

const sharedQueueConfig: any = {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
};

@Global()
@Module({
  imports: [
    BullModule.forRoot(sharedQueueConfig),
  ],
})
export class SharedQueueModule {}
