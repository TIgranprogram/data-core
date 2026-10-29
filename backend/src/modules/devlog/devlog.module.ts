import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DevlogController } from './devlog.controller';
import { DevlogService } from './devlog.service';
import {
  DevlogCommit, DevlogCommitSchema, DevlogDoc, DevlogDocSchema, DevlogItem, DevlogItemSchema, DevlogKit, DevlogKitSchema,
  DevlogRelease, DevlogReleaseSchema, DevlogSession, DevlogSessionSchema,
} from './devlog.schemas';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DevlogRelease.name, schema: DevlogReleaseSchema },
      { name: DevlogCommit.name, schema: DevlogCommitSchema },
      { name: DevlogSession.name, schema: DevlogSessionSchema },
      { name: DevlogItem.name, schema: DevlogItemSchema },
      { name: DevlogDoc.name, schema: DevlogDocSchema },
      { name: DevlogKit.name, schema: DevlogKitSchema },
    ]),
  ],
  controllers: [DevlogController],
  providers: [DevlogService],
})
export class DevlogModule {}
