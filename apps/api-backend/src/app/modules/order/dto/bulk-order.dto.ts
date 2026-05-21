import { IsArray, IsString, ArrayNotEmpty, ArrayMaxSize } from 'class-validator';

export class BulkApproveDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  orderIds: string[];
}

export class BulkPlanDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  orderIds: string[];

  @IsString()
  targetDate: string;
}
