import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { RouteService } from './route.service';
import { CreateRouteDto } from './dto/create-route.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('routes')
export class RouteController {
  constructor(private readonly routeService: RouteService) {}

  @Post()
  create(@CurrentUser() user: any, @Body() createRouteDto: CreateRouteDto) {
    return this.routeService.create(user.vendorId, createRouteDto);
  }

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.routeService.findAll(user.vendorId);
  }
}
