import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsModule } from '../notifications/notifications.module';
import { Message, MessageSchema } from './message.schema';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

/** /api/messages — мини-чат; новое сообщение даёт «важное» уведомление получателю. */
@Module({
  imports: [MongooseModule.forFeature([{ name: Message.name, schema: MessageSchema }]), NotificationsModule],
  controllers: [MessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
