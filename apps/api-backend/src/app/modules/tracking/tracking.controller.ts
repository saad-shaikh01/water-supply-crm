import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { filter, map } from 'rxjs/operators';
import { Request, Response } from 'express';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TrackingService } from './tracking.service';
import { UpdateLocationDto } from './dto/update-location.dto';

@Controller('tracking')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  /**
   * POST /api/tracking/location
   * Drivers call this to push their GPS location.
   */
  @Post('location')
  @Roles(UserRole.DRIVER, UserRole.STAFF, UserRole.VENDOR_ADMIN)
  async updateLocation(
    @CurrentUser() user: any,
    @Body() dto: UpdateLocationDto,
  ) {
    await this.trackingService.updateLocation(
      user.userId,
      user.name ?? 'Driver',
      user.vendorId,
      dto,
    );
    return { success: true, updatedAt: new Date().toISOString() };
  }

  /**
   * GET /api/tracking/active
   * Returns a snapshot of all active drivers for the vendor.
   */
  @Get('active')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.SUPER_ADMIN)
  async getActiveDrivers(@CurrentUser() user: any) {
    return this.trackingService.getActiveDrivers(user.vendorId);
  }

  /**
   * GET /api/tracking/driver/:driverId
   * Returns the last known location for a single driver.
   */
  @Get('driver/:driverId')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.SUPER_ADMIN)
  async getDriverLocation(
    @CurrentUser() user: any,
    @Param('driverId') driverId: string,
  ) {
    const loc = await this.trackingService.getDriverLocationResilient(driverId, user.vendorId);
    return { location: loc ?? null };
  }

  /**
   * GET /api/tracking/subscribe
   * Server-Sent Events stream — dashboard clients subscribe here.
   * Sends live location updates for the authenticated vendor's drivers.
   *
   * Auth: Guarded by JwtAuthGuard + RolesGuard before SSE headers are flushed.
   * Browser EventSource cannot send custom headers, so pass the JWT as a query
   * parameter: `/api/tracking/subscribe?token=<jwt>`
   * JwtStrategy extracts and validates it via `fromExtractors`.
   *
   * Client usage (browser):
   *   const es = new EventSource(`/api/tracking/subscribe?token=${jwt}`);
   *   es.onmessage = (e) => { const location = JSON.parse(e.data); ... };
   */
  @Get('subscribe')
  @Roles(UserRole.VENDOR_ADMIN, UserRole.STAFF, UserRole.SUPER_ADMIN)
  subscribe(@CurrentUser() user: any, @Res() res: Response, @Req() req: Request) {
    // SSE headers — flushed only after JwtAuthGuard succeeds
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering for SSE
    res.flushHeaders();

    // Heartbeat every 20s to keep the connection alive through proxies
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 20_000);

    // Push initial snapshot immediately so dashboard shows existing markers on connect
    this.trackingService.getActiveDrivers(user.vendorId).then((drivers) => {
      for (const driver of drivers) {
        res.write(`data: ${JSON.stringify(driver)}\n\n`);
      }
    }).catch(() => {
      // Non-fatal — live events will still arrive via Pub/Sub
    });

    // Subscribe to live Redis Pub/Sub events filtered strictly to this vendor
    const subscription = this.trackingService.locationEvents$
      .pipe(
        filter((event) => event.vendorId === user.vendorId),
        map((event) => event.data),
      )
      .subscribe({
        next: (location) => {
          res.write(`data: ${JSON.stringify(location)}\n\n`);
        },
        error: () => {
          clearInterval(heartbeat);
          res.end();
        },
      });

    // Clean up when client disconnects or connection drops
    req.on('close', () => {
      clearInterval(heartbeat);
      subscription.unsubscribe();
      res.end();
    });
  }
}
