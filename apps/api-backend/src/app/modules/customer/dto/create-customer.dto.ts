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

export class CreateCustomerDto {
  @IsOptional()
  @IsEnum(PaymentType)
  paymentType?: PaymentType = PaymentType.CASH;
  @IsString()
  customerCode!: string;

  @IsString()
  name!: string;

  @IsString()
  address!: string;

  @IsString()
  phoneNumber!: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsArray()
  @IsInt({ each: true })
  deliveryDays!: number[];

  @IsOptional()
  @IsUUID()
  routeId?: string;
}
