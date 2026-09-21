import { IsOptional, IsUUID } from 'class-validator';

/**
 * Query for the transfer preview. Every param must be declared here — the global
 * ValidationPipe is `whitelist + forbidNonWhitelisted`.
 */
export class TransferPreviewQueryDto {
  @IsUUID()
  fromCustomerId: string;

  /** Optional: when given, the preview also checks the target (exists, same vendor, active). */
  @IsOptional()
  @IsUUID()
  toCustomerId?: string;
}
