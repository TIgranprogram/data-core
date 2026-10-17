import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RoutingStep, RoutingStepSchema } from './routing-step.schema';
import { RoutingStepService } from './routing-step.service';
import { RoutingStepController } from './routing-step.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RoutingStep.name, schema: RoutingStepSchema },
    ]),
  ],
  controllers: [RoutingStepController],
  providers: [RoutingStepService],
  exports: [RoutingStepService, MongooseModule],
})
export class RoutingStepModule {}
