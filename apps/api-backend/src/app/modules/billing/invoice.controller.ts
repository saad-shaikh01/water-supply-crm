import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@water-supply-crm/types';
import { RequireSuperAdmin } from '../../common/decorators/authz-markers.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { InvoiceService } from './invoice.service';
import {
  CreateInvoiceDto,
  ListInvoicesQueryDto,
  RecordPaymentDto,
  UpdateInvoiceDto,
  VoidInvoiceDto,
} from './dto/invoice.dto';

// Platform surface — super-admin only.
@Controller('platform/invoices')
@RequireSuperAdmin()
export class InvoiceController {
  constructor(private readonly invoices: InvoiceService) {}

  @Get()
  list(@Query() query: ListInvoicesQueryDto) {
    return this.invoices.list(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.findOne(id);
  }

  @Post()
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 30 } })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateInvoiceDto) {
    return this.invoices.create(dto, user);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInvoiceDto) {
    return this.invoices.update(id, dto, user);
  }

  @Post(':id/issue')
  issue(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.issue(id, user);
  }

  @Post(':id/payments')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 30 } })
  recordPayment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordPaymentDto) {
    return this.invoices.recordPayment(id, dto, user);
  }

  @Post(':id/void')
  void(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidInvoiceDto) {
    return this.invoices.void(id, dto, user);
  }
}
