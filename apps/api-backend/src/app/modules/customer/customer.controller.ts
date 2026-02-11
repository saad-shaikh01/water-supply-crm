import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Post()
  create(@CurrentUser() user: any, @Body() createCustomerDto: CreateCustomerDto) {
    return this.customerService.create(user.vendorId, createCustomerDto);
  }

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.customerService.findAll(user.vendorId);
  }
}
