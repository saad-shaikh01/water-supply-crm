import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import type { AuthUser, FleetAlertRecipientEntry } from '@water-supply-crm/types';
import { AuditService } from '../audit/audit.service';
import { CreateFleetAlertRecipientDto } from './dto/create-fleet-alert-recipient.dto';
import { UpdateFleetAlertRecipientDto } from './dto/update-fleet-alert-recipient.dto';
import { normalizePhone, isSendablePhone } from '../whatsapp/phone.util';

/**
 * Vendor-wide WhatsApp recipient list for FleetNotificationService's nightly
 * sweep — see the FleetAlertRecipient schema comment. Deliberately not tied to
 * an existing User (owner/manager often has no login), so this is its own
 * small CRUD surface rather than riding on the User model.
 */
@Injectable()
export class FleetAlertRecipientService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async list(vendorId: string): Promise<FleetAlertRecipientEntry[]> {
    const rows = await this.prisma.fleetAlertRecipient.findMany({
      where: { vendorId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(this.toEntry);
  }

  /** Active recipients only — what the nightly sweep actually sends to. */
  async listActivePhones(vendorId: string): Promise<{ name: string; phone: string }[]> {
    const rows = await this.prisma.fleetAlertRecipient.findMany({
      where: { vendorId, isActive: true },
      select: { name: true, phone: true },
    });
    return rows.filter((r) => isSendablePhone(r.phone));
  }

  async create(user: AuthUser, dto: CreateFleetAlertRecipientDto): Promise<FleetAlertRecipientEntry> {
    const name = dto.name.replace(/\s+/g, ' ').trim();
    const phone = normalizePhone(dto.phone);
    if (!isSendablePhone(phone)) throw new BadRequestException('Enter a valid WhatsApp number, e.g. 0300-1234567');

    const created = await this.prisma.fleetAlertRecipient.create({
      data: { vendorId: user.vendorId, name, phone, createdById: user.userId },
    });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'CREATED',
      entity: 'FleetAlertRecipient',
      entityId: created.id,
      changes: { after: created },
    });

    return this.toEntry(created);
  }

  async update(user: AuthUser, id: string, dto: UpdateFleetAlertRecipientDto): Promise<FleetAlertRecipientEntry> {
    const existing = await this.prisma.fleetAlertRecipient.findFirst({ where: { id, vendorId: user.vendorId } });
    if (!existing) throw new NotFoundException('Alert recipient not found');

    const data: { name?: string; phone?: string; isActive?: boolean } = {};
    if (dto.name !== undefined) {
      const name = dto.name.replace(/\s+/g, ' ').trim();
      if (name.length < 2) throw new BadRequestException('Name is too short');
      data.name = name;
    }
    if (dto.phone !== undefined) {
      const phone = normalizePhone(dto.phone);
      if (!isSendablePhone(phone)) throw new BadRequestException('Enter a valid WhatsApp number, e.g. 0300-1234567');
      data.phone = phone;
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const updated = await this.prisma.fleetAlertRecipient.update({ where: { id }, data });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'UPDATED',
      entity: 'FleetAlertRecipient',
      entityId: id,
      changes: { before: existing, after: updated },
    });

    return this.toEntry(updated);
  }

  async remove(user: AuthUser, id: string): Promise<{ deleted: true }> {
    const existing = await this.prisma.fleetAlertRecipient.findFirst({ where: { id, vendorId: user.vendorId } });
    if (!existing) throw new NotFoundException('Alert recipient not found');

    await this.prisma.fleetAlertRecipient.delete({ where: { id } });

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'DELETED',
      entity: 'FleetAlertRecipient',
      entityId: id,
      changes: { before: existing },
    });

    return { deleted: true };
  }

  private toEntry(row: {
    id: string;
    name: string;
    phone: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): FleetAlertRecipientEntry {
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
