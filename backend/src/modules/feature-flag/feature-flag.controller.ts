import {
  Body,
  Controller,
  Get,
  Param,
  Put,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { FeatureFlagService } from './feature-flag.service';

interface UpdateFlagDto {
  label?: string;
  description?: string;
  enabledByDefault?: boolean;
  category?: string;
  isActive?: boolean;
}

@Controller('feature-flags')
export class FeatureFlagController {
  constructor(private readonly service: FeatureFlagService) {}

  @Get()
  @Roles('admin', 'manager')
  findAll() {
    return this.service.findAll();
  }

  @Get(':key')
  @Roles('admin', 'manager', 'user')
  findOne(@Param('key') key: string) {
    return this.service.findByKey(key);
  }

  @Put(':key')
  @Roles('admin')
  upsert(@Param('key') key: string, @Body() dto: UpdateFlagDto) {
    return this.service.upsert(key, dto);
  }
}
