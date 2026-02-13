import { IsString, IsIn } from 'class-validator';

export class RegisterFcmTokenDto {
  @IsString()
  token: string;

  @IsIn(['android', 'ios', 'web'])
  platform: string;
}
