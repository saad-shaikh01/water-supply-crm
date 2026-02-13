import { Module } from '@nestjs/common';
import { CustomerPortalService } from './customer-portal.service';
import { CustomerPortalController } from './customer-portal.controller';
import { CustomerModule } from '../customer/customer.module';

@Module({
  imports: [CustomerModule],
  controllers: [CustomerPortalController],
  providers: [CustomerPortalService],
})
export class CustomerPortalModule {}
