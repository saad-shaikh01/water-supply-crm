import { IsBoolean } from 'class-validator';

export class UpdateAutoRefillConfigDto {
  @IsBoolean()
  enabled!: boolean;
}
