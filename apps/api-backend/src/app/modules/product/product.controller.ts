import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  create(@CurrentUser() user: any, @Body() createProductDto: CreateProductDto) {
    return this.productService.create(user.vendorId, createProductDto);
  }

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.productService.findAll(user.vendorId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.productService.findOne(user.vendorId, id);
  }
}
