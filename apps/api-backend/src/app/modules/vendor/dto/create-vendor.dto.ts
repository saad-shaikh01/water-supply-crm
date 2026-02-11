export class CreateVendorDto {
  name: string;
  slug: string;
  address?: string;
  logoUrl?: string;

  // Initial Admin Details
  adminEmail!: string;
  adminPassword!: string;
  adminName!: string;
}
