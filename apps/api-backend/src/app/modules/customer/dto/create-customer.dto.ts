export class CreateCustomerDto {
  customerCode!: string;
  name!: string;
  address!: string;
  phoneNumber!: string;
  latitude?: number;
  longitude?: number;
  deliveryDays!: number[]; // e.g., [1, 4]
  routeId?: string;
}
