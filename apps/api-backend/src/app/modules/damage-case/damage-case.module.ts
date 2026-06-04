import { Module } from '@nestjs/common';
import { DamageCaseService } from './damage-case.service';
import { DamageCaseController } from './damage-case.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { FcmModule } from '../fcm/fcm.module';
import { StorageModule } from '../../common/storage/storage.module';

@Module({
  imports: [NotificationsModule, FcmModule, StorageModule],
  controllers: [DamageCaseController],
  providers: [DamageCaseService],
})
export class DamageCaseModule {}
