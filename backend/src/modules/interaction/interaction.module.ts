import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Interaction, InteractionSchema } from './interaction.schema';
import { InteractionService } from './interaction.service';
import { InteractionController } from './interaction.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Interaction.name, schema: InteractionSchema }]),
  ],
  controllers: [InteractionController],
  providers: [InteractionService],
  exports: [InteractionService, MongooseModule],
})
export class InteractionModule {}
