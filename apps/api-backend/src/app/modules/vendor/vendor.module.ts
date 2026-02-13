import { Module } from '@nestjs/common';
import { VendorService } from './vendor.service';
import { VendorController } from './vendor.controller';
import { UserModule } from '../user/user.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [UserModule, AuditModule],
  controllers: [VendorController],
  providers: [VendorService],
})
export class VendorModule {}
