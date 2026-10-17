import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CartItem, CartItemSchema } from './cart-item.schema';
import { CartItemService } from './cart-item.service';
import { CartItemController } from './cart-item.controller';
import { Product, ProductSchema } from '../product/product.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CartItem.name, schema: CartItemSchema },
      { name: Product.name, schema: ProductSchema },
    ]),
  ],
  controllers: [CartItemController],
  providers: [CartItemService],
  exports: [CartItemService, MongooseModule],
})
export class CartItemModule {}
