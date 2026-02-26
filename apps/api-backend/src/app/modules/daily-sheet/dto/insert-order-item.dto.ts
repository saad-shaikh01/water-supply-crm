import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export enum SequenceMode {
  APPEND = 'APPEND',
  CUSTOM = 'CUSTOM',
}

export class InsertOrderItemDto {
  @IsString()
  orderId: string;

  @IsOptional()
  @IsEnum(SequenceMode)
  sequenceMode?: SequenceMode = SequenceMode.APPEND;

  @IsOptional()
  @IsInt()
  @Min(1)
  sequence?: number;
}
