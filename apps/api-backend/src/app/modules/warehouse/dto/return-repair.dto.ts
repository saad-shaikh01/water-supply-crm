import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ReturnRepairDto {
  @IsInt()
  @Min(0)
  bottlesReturned!: number;

  @IsInt()
  @Min(0)
  bottlesWrittenOff!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
