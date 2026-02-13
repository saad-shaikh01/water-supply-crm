import { IsString, MinLength } from 'class-validator';

export class ResetAdminPasswordDto {
  @IsString()
  @MinLength(8)
  newPassword: string;
}
