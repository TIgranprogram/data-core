import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MaterialRequestsController } from './material-requests.controller';
import { MaterialRequestsService } from './material-requests.service';
import { MaterialRequest, MaterialRequestSchema } from './material-request.schema';

/** /api/material-requests — заявки кладовщика на новую позицию склада; коллекция data-core `materialrequests`. */
@Module({
  imports: [MongooseModule.forFeature([{ name: MaterialRequest.name, schema: MaterialRequestSchema }])],
  controllers: [MaterialRequestsController],
  providers: [MaterialRequestsService],
})
export class MaterialRequestsModule {}
