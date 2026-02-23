import {
  IsString,
  IsOptional,
  IsNumber,
  IsUUID,
  IsEnum,
  ValidateNested,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentType } from '@prisma/client';
import { DeliveryScheduleItemDto } from './delivery-schedule-item.dto';

export class CreateCustomerDto {
  @IsOptional()
  @IsEnum(PaymentType)
  paymentType?: PaymentType = PaymentType.CASH;

  @IsOptional()
  @IsString()
  customerCode?: string; // auto-generated if not provided

  @IsString()
  name!: string;

  @IsString()
  phoneNumber!: string;

  // Location
  @IsString()
  address!: string;

  @IsOptional()
  @IsString()
  floor?: string;

  @IsOptional()
  @IsString()
  nearbyLandmark?: string;

  @IsOptional()
  @IsString()
  deliveryInstructions?: string;

  @IsOptional()
  @IsString()
  googleMapsUrl?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliveryScheduleItemDto)
  deliverySchedule!: DeliveryScheduleItemDto[];

  @IsOptional()
  @IsUUID()
  routeId?: string;
}
