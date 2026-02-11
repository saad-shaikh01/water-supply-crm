import { Module } from '@nestjs/common';
import { VendorService } from './vendor.service';
import { VendorController } from './vendor.controller';
import { UserModule } from '../user/user.module';

@Module({
  imports: [UserModule],
  controllers: [VendorController],
  providers: [VendorService],
})
export class VendorModule {}
