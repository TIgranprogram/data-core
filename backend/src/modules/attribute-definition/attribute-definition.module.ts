import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AttributeDefinition, AttributeDefinitionSchema } from './attribute-definition.schema';
import { AttributeDefinitionService } from './attribute-definition.service';
import { AttributeDefinitionController } from './attribute-definition.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AttributeDefinition.name, schema: AttributeDefinitionSchema },
    ]),
  ],
  controllers: [AttributeDefinitionController],
  providers: [AttributeDefinitionService],
  exports: [AttributeDefinitionService, MongooseModule],
})
export class AttributeDefinitionModule {}
