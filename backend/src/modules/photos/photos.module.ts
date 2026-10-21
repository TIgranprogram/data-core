import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { MongooseModule } from '@nestjs/mongoose';
import { Photo, PhotoSchema } from './photo.schema';
import { PhotosService } from './photos.service';
import { PhotosController } from './photos.controller';
import { imageUploadMulterOptions } from './image-upload.options';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Photo.name, schema: PhotoSchema }]),
    MulterModule.register(imageUploadMulterOptions),
  ],
  controllers: [PhotosController],
  providers: [PhotosService],
  exports: [PhotosService, MongooseModule],
})
export class PhotosModule {}
