import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ClientError, ClientErrorSchema } from './client-error.schema';
import { ClientErrorsService } from './client-errors.service';
import { ClientErrorsController } from './client-errors.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: ClientError.name, schema: ClientErrorSchema }])],
  controllers: [ClientErrorsController],
  providers: [ClientErrorsService],
})
export class ClientErrorsModule {}
