import {
  Body,
  Controller,
  InternalServerErrorException,
  Post,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CounterService } from './counter.service';

interface CounterTestDto {
  entity: string;
  prefix: string;
  year: number;
}

@Controller('internal/counter')
export class CounterController {
  constructor(private readonly counterService: CounterService) {}

  /**
   * Test endpoint for verifying atomic sequence generation.
   * Disabled in production. Will be removed once TZ-17 E2E tests are in place.
   */
  @Post('test')
  @Roles('admin', 'manager')
  async test(@Body() body: CounterTestDto): Promise<{ seq: string }> {
    if (process.env.NODE_ENV === 'production') {
      throw new InternalServerErrorException(
        'Test endpoint is disabled in production',
      );
    }

    const seq = await this.counterService.next(
      body.entity,
      body.prefix,
      body.year,
    );
    return { seq };
  }
}
