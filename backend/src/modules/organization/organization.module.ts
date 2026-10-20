import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { Organization, OrganizationSchema } from './organization.schema';
import { OrganizationService } from './organization.service';
import { OrganizationController } from './organization.controller';
import { OrganizationContactModule } from './contacts/organization-contact.module';
import { PhotosModule } from '../photos/photos.module';
import { imageUploadMulterOptions } from '../photos/image-upload.options';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Organization.name, schema: OrganizationSchema }]),
    OrganizationContactModule,
    // TZ-ORG-ASSETS-301: логотип/печать/подпись идут через тот же pipeline
    // картинок, что и `POST /photos/upload` — общий конфиг, не второй.
    PhotosModule,
    MulterModule.register(imageUploadMulterOptions),
  ],
  controllers: [OrganizationController],
  providers: [OrganizationService],
  exports: [OrganizationService, MongooseModule],
})
export class OrganizationModule {}
