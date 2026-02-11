import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { VanService } from './van.service';
import { CreateVanDto } from './dto/create-van.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('vans')
export class VanController {
  constructor(private readonly vanService: VanService) {}

  @Post()
  create(@CurrentUser() user: any, @Body() createVanDto: CreateVanDto) {
    return this.vanService.create(user.vendorId, createVanDto);
  }

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.vanService.findAll(user.vendorId);
  }
}
