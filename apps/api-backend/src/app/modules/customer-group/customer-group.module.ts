import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CustomerGroupAdminController, CustomerGroupController } from './customer-group.controller';
import { CustomerGroupService } from './customer-group.service';

@Module({
  imports: [AuditModule],
  controllers: [CustomerGroupController, CustomerGroupAdminController],
  providers: [CustomerGroupService],
  exports: [CustomerGroupService],
})
export class CustomerGroupModule {}
