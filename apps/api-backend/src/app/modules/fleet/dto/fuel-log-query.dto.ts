import { IsOptional, IsUUID, IsDateString, IsString, MaxLength, IsIn } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class FuelLogQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() vehicleId?: string;
  @IsOptional() @IsDateString() dateFrom?: string;
  @IsOptional() @IsDateString() dateTo?: string;
  @IsOptional() @IsUUID() recordedById?: string;
  @IsOptional() @IsUUID() fuelCardId?: string;
  // 'cash' = paid from driver van cash, 'other' = card/bank/fuel-card. Strings
  // (not booleans) to sidestep the enableImplicitConversion boolean-query bug.
  @IsOptional() @IsIn(['cash', 'other']) payment?: 'cash' | 'other';
  @IsOptional() @IsIn(['full', 'partial']) tank?: 'full' | 'partial';
  @IsOptional() @IsString() @MaxLength(80) station?: string;
}
