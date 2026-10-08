import { Module } from '@nestjs/common';
import { CustomerPortalService } from './customer-portal.service';
import { CustomerPortalController, PortalPublicController } from './customer-portal.controller';
import { CustomerModule } from '../customer/customer.module';

@Module({
  imports: [CustomerModule],
  controllers: [CustomerPortalController, PortalPublicController],
  providers: [CustomerPortalService],
})
export class CustomerPortalModule {}
