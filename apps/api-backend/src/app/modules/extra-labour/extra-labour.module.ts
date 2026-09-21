import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ExtraLabourController } from './extra-labour.controller';
import { ExtraLabourService } from './extra-labour.service';
import { ExtraLabourTypeService } from './extra-labour-type.service';

@Module({
  imports: [AuditModule],
  controllers: [ExtraLabourController],
  providers: [ExtraLabourService, ExtraLabourTypeService],
  exports: [ExtraLabourService, ExtraLabourTypeService],
})
export class ExtraLabourModule {}
