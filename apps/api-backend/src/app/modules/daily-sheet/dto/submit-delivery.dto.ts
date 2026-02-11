import { DeliveryStatus } from '@prisma/client';

export class SubmitDeliveryDto {
  status!: DeliveryStatus;
  filledDropped!: number;
  emptyReceived!: number;
  cashCollected!: number;
  reason?: string;
}
