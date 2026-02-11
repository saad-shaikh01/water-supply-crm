import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { GenerateSheetsDto } from './dto/generate-sheets.dto';
import { SubmitDeliveryDto } from './dto/submit-delivery.dto';
import { LedgerService } from '../transaction/ledger.service';
import { DeliveryStatus } from '@prisma/client';

@Injectable()
export class DailySheetService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService
  ) {}

  async submitDelivery(vendorId: string, itemId: string, dto: SubmitDeliveryDto) {
    const item = await this.prisma.dailySheetItem.findUnique({
      where: { id: itemId },
      include: { 
        customer: { include: { customPrices: true } },
        product: true 
      },
    });

    if (!item || item.dailySheetId === '') { // Simple check
        throw new NotFoundException('Sheet item not found');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Update Sheet Item Status
      const updatedItem = await tx.dailySheetItem.update({
        where: { id: itemId },
        data: {
          status: dto.status,
          filledDropped: dto.filledDropped,
          emptyReceived: dto.emptyReceived,
          cashCollected: dto.cashCollected,
          reason: dto.reason,
        },
      });

      // 2. If status is COMPLETED or EMPTY_ONLY, record in Ledger
      if (dto.status === DeliveryStatus.COMPLETED || dto.status === DeliveryStatus.EMPTY_ONLY) {
        // Determine price (custom or base)
        const customPrice = item.customer.customPrices.find(p => p.productId === item.productId);
        const price = customPrice ? customPrice.customPrice : item.product.basePrice;

        await this.ledger.recordDelivery({
          vendorId,
          customerId: item.customerId,
          productId: item.productId,
          dailySheetId: item.dailySheetId,
          filledDropped: dto.filledDropped,
          emptyReceived: dto.emptyReceived,
          cashCollected: dto.cashCollected,
          pricePerBottle: price,
        });
      }

      return updatedItem;
    });
  }

  async generate(vendorId: string, dto: GenerateSheetsDto) {
    const targetDate = new Date(dto.date);
    const dayOfWeek = targetDate.getDay(); // 0 (Sun) to 6 (Sat)

    // 1. Get all routes for this vendor
    const routes = await this.prisma.route.findMany({
      where: { vendorId },
      include: {
        customers: {
          where: { deliveryDays: { has: dayOfWeek } },
        },
      },
    });

    const generatedSheets = [];

    for (const route of routes) {
      if (route.customers.length === 0) continue;

      // 2. Find assigned van for this route (using a simple logic for now: van linked to vendor)
      // In a real scenario, we might want a explicit Route -> Van mapping. 
      // For now, we find the first van that has this route.
      const van = await this.prisma.van.findFirst({
        where: { vendorId },
        include: { defaultDriver: true },
      });

      if (!van || !van.defaultDriverId) continue;

      // Check if sheet already exists
      const existing = await this.prisma.dailySheet.findFirst({
        where: {
          vendorId,
          routeId: route.id,
          date: {
            gte: new Date(targetDate.setHours(0,0,0,0)),
            lt: new Date(targetDate.setHours(23,59,59,999)),
          },
        },
      });

      if (existing) continue;

      // 3. Get default product ID for this vendor
      const defaultProduct = await this.prisma.product.findFirst({
        where: { vendorId, isActive: true },
      });

      if (!defaultProduct) continue;

      // 4. Create Sheet
      const sheet = await this.prisma.dailySheet.create({
        data: {
          vendorId,
          routeId: route.id,
          vanId: van.id,
          driverId: van.defaultDriverId,
          date: targetDate,
          items: {
            create: route.customers.map((customer, index) => ({
              customerId: customer.id,
              sequence: index + 1,
              productId: defaultProduct.id,
            })),
          },
        },
        include: { items: true },
      });

      generatedSheets.push(sheet);
    }

    return generatedSheets;
  }

  async findAll(vendorId: string) {
    return this.prisma.dailySheet.findMany({
      where: { vendorId },
      include: { route: true, van: true, driver: true, _count: { select: { items: true } } },
      orderBy: { date: 'desc' },
    });
  }

  async findOne(vendorId: string, id: string) {
    return this.prisma.dailySheet.findUnique({
      where: { id },
      include: { 
        route: true, 
        van: true, 
        driver: true, 
        items: {
          include: { customer: true, product: true }
        }
      },
    });
  }
}
