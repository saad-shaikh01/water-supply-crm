import { IsString, IsBoolean, IsIn } from 'class-validator';

export class UpsertPreferenceDto {
  @IsString()
  eventType: string;

  @IsIn(['WHATSAPP', 'SMS', 'FCM', 'IN_APP'])
  channel: string;

  @IsBoolean()
  enabled: boolean;
}
