import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

/** Soft Close (Amendment R9): Staff/Admin's reason for sending a self-closed
 * sheet back to the driver/salesman for correction. */
export class RejectCloseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
