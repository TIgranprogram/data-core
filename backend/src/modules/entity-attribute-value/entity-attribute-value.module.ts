import { Module, Global } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EntityAttributeValue, EntityAttributeValueSchema } from './entity-attribute-value.schema';
import { EntityAttributeValueService } from './entity-attribute-value.service';
import { EntityAttributeValueController } from './entity-attribute-value.controller';
import { EavService } from '../../common/eav/eav.service';
import { AttributeDefinitionModule } from '../attribute-definition/attribute-definition.module';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EntityAttributeValue.name, schema: EntityAttributeValueSchema },
    ]),
    AttributeDefinitionModule,
  ],
  controllers: [EntityAttributeValueController],
  providers: [EavService, EntityAttributeValueService],
  exports: [EavService, EntityAttributeValueService],
})
export class EntityAttributeValueModule {}
