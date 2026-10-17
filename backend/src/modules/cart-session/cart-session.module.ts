import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CartSession, CartSessionSchema } from './cart-session.schema';
import { CartSessionService } from './cart-session.service';
import { CartSessionController } from './cart-session.controller';
import { CartItem, CartItemSchema } from '../cart-item/cart-item.schema';
import { QuotationModule } from '../quotation/quotation.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CartSession.name, schema: CartSessionSchema },
      { name: CartItem.name, schema: CartItemSchema },
    ]),
    QuotationModule,
  ],
  controllers: [CartSessionController],
  providers: [CartSessionService],
  exports: [CartSessionService],
})
export class CartSessionModule {}
