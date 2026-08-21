import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';

/**
 * Base Vehicle CRUD — the physical-vehicle entity itself (plate, usual
 * route, active flag), split out of Van by the §17 Amendment (2026-08-21).
 * Enrichment (make/model/documents/etc.) stays on VehicleProfileService,
 * exactly like it did when it hung off Van (plan doc §4) — this service
 * only owns creating/retiring the base row and its two own fields.
 * Mirrors VanService's vendor-scoping + isActive soft-disable pattern.
 */
@Injectable()
export class VehicleService {
  constructor(private prisma: PrismaService) {}

  async create(vendorId: string, dto: CreateVehicleDto) {
    if (dto.usualVanId) {
      const van = await this.prisma.van.findFirst({ where: { id: dto.usualVanId, vendorId } });
      if (!van) throw new NotFoundException('Van not found');
    }

    return this.prisma.vehicle.create({
      data: {
        vendorId,
        plateNumber: dto.plateNumber,
        usualVanId: dto.usualVanId ?? null,
      },
    });
  }

  async update(vendorId: string, id: string, dto: UpdateVehicleDto) {
    const vehicle = await this.prisma.vehicle.findFirst({ where: { id, vendorId } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');

    if (dto.usualVanId) {
      const van = await this.prisma.van.findFirst({ where: { id: dto.usualVanId, vendorId } });
      if (!van) throw new NotFoundException('Van not found');
    }

    return this.prisma.vehicle.update({
      where: { id },
      data: {
        ...(dto.plateNumber !== undefined && { plateNumber: dto.plateNumber }),
        ...(dto.usualVanId !== undefined && { usualVanId: dto.usualVanId }),
      },
    });
  }

  async deactivate(vendorId: string, id: string) {
    const vehicle = await this.prisma.vehicle.findFirst({ where: { id, vendorId } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');

    const openTrip = await this.prisma.vehicleDailyCheck.findFirst({
      where: {
        vehicleId: id,
        checkType: 'START',
        dailySheet: { isClosed: false },
      },
    });
    if (openTrip) {
      throw new ConflictException('Vehicle is currently checked out on an open trip. Close that trip before deactivating.');
    }

    return this.prisma.vehicle.update({ where: { id }, data: { isActive: false } });
  }

  async reactivate(vendorId: string, id: string) {
    const vehicle = await this.prisma.vehicle.findFirst({ where: { id, vendorId } });
    if (!vehicle) throw new NotFoundException('Vehicle not found');

    return this.prisma.vehicle.update({ where: { id }, data: { isActive: true } });
  }
}
