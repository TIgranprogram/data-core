import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DeskNote, DeskNoteSchema } from './desk-note.schema';
import { DeskNoteController } from './desk-note.controller';
import { DeskNoteService } from './desk-note.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DeskNote.name, schema: DeskNoteSchema },
    ]),
  ],
  controllers: [DeskNoteController],
  providers: [DeskNoteService],
  exports: [DeskNoteService, MongooseModule],
})
export class DeskNoteModule {}
