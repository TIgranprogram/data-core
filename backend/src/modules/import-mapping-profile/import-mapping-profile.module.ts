import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ImportMappingProfile,
  ImportMappingProfileSchema,
} from './import-mapping-profile.schema';
import { ImportMappingProfileController } from './import-mapping-profile.controller';
import { ImportMappingProfileService } from './import-mapping-profile.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ImportMappingProfile.name, schema: ImportMappingProfileSchema },
    ]),
  ],
  controllers: [ImportMappingProfileController],
  providers: [ImportMappingProfileService],
  exports: [ImportMappingProfileService],
})
export class ImportMappingProfileModule {}
