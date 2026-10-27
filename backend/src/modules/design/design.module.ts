import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CounterModule } from '../counter/counter.module';
import { DesignBoardController } from './design-board.controller';
import { DesignBoardService } from './design-board.service';
import { DesignExtrasService } from './design-extras.service';
import { DesignStickerController } from './design-sticker.controller';
import { DesignStickerService } from './design-sticker.service';
import { DesignSticker, DesignStickerSchema } from './design-sticker.schema';
import { DesignNoteController } from './design-note.controller';
import { DesignNote, DesignNoteSchema } from './design-note.schema';
import { DesignNoteService } from './design-note.service';
import { DesignOrder, DesignOrderSchema } from './design-order.schema';
import { DesignTask, DesignTaskSchema } from './design-task.schema';
import { DesignController } from './design.controller';
import { DesignService } from './design.service';

/** /api/design-tasks — «Проектирование»: задачи на чертежи под позиции заказов (`designtasks`); /api/design-board — доска заказов (`designorders`); /api/design-stickers — стикеры доски (`designstickers`). */
@Module({
  imports: [MongooseModule.forFeature([{ name: DesignTask.name, schema: DesignTaskSchema }, { name: DesignOrder.name, schema: DesignOrderSchema }, { name: DesignSticker.name, schema: DesignStickerSchema }, { name: DesignNote.name, schema: DesignNoteSchema }]), CounterModule],
  controllers: [DesignController, DesignBoardController, DesignStickerController, DesignNoteController],
  providers: [DesignService, DesignBoardService, DesignStickerService, DesignExtrasService, DesignNoteService],
})
export class DesignModule {}
