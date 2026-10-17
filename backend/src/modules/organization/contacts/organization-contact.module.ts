import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrganizationContact, OrganizationContactSchema } from './organization-contact.schema';
import { OrganizationContactService } from './organization-contact.service';
import { OrganizationContactController } from './organization-contact.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: OrganizationContact.name, schema: OrganizationContactSchema }]),
  ],
  controllers: [OrganizationContactController],
  providers: [OrganizationContactService],
  exports: [OrganizationContactService, MongooseModule],
})
export class OrganizationContactModule {}
