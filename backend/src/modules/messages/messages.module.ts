import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsModule } from '../notifications/notifications.module';
import { Message, MessageRead, MessageReadSchema, MessageSchema } from './message.schema';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

/** /api/messages — мини-чат (личные и «Всем»); личное сообщение даёт «важное» уведомление получателю. */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Message.name, schema: MessageSchema }, { name: MessageRead.name, schema: MessageReadSchema }]),
    NotificationsModule,
  ],
  controllers: [MessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
