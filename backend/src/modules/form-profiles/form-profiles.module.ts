import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FormProfile, FormProfileSchema } from './form-profile.schema';
import { FormProfilesService } from './form-profiles.service';
import { FormProfilesController } from './form-profiles.controller';
import {
  Organization,
  OrganizationSchema,
} from '../organization/organization.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FormProfile.name, schema: FormProfileSchema },
      { name: Organization.name, schema: OrganizationSchema },
    ]),
  ],
  controllers: [FormProfilesController],
  providers: [FormProfilesService],
  exports: [FormProfilesService, MongooseModule],
})
export class FormProfilesModule {}
