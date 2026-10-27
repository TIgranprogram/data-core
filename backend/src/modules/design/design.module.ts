import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CounterModule } from '../counter/counter.module';
import { DesignBoardController } from './design-board.controller';
import { DesignBoardService } from './design-board.service';
import { DesignExtrasService } from './design-extras.service';
import { DesignStickerController } from './design-sticker.controller';
import { DesignStickerService } from './design-sticker.service';
import { DesignSticker, DesignStickerSchema } from './design-sticker.schema';
import { DesignOrder, DesignOrderSchema } from './design-order.schema';
import { DesignTask, DesignTaskSchema } from './design-task.schema';
import { DesignController } from './design.controller';
import { DesignService } from './design.service';

/** /api/design-tasks — «Проектирование»: задачи на чертежи под позиции заказов (`designtasks`); /api/design-board — доска заказов (`designorders`); /api/design-stickers — стикеры доски (`designstickers`). */
@Module({
  imports: [MongooseModule.forFeature([{ name: DesignTask.name, schema: DesignTaskSchema }, { name: DesignOrder.name, schema: DesignOrderSchema }, { name: DesignSticker.name, schema: DesignStickerSchema }]), CounterModule],
  controllers: [DesignController, DesignBoardController, DesignStickerController],
  providers: [DesignService, DesignBoardService, DesignStickerService, DesignExtrasService],
})
export class DesignModule {}
