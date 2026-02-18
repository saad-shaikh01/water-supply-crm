import {
  IsString,
  IsOptional,
  IsArray,
  IsInt,
  IsNumber,
  IsUUID,
  IsEnum,
} from 'class-validator';
import { PaymentType } from '@prisma/client';

export class UpdateCustomerDto {
  @IsOptional()
  @IsEnum(PaymentType)
  paymentType?: PaymentType;
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  deliveryDays?: number[];

  @IsOptional()
  @IsUUID()
  routeId?: string;
}
