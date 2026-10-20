import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AuditAction } from '../../common/interceptors/audit.interceptor';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateCounterpartyDto } from './dto/create-counterparty.dto';
import { UpdateCounterpartyDto } from './dto/update-counterparty.dto';
import { QuickCreatePartyDto } from './dto/quick-create-party.dto';
import { CounterpartyService } from './counterparty.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('counterparties')
export class CounterpartyController {
  constructor(private readonly service: CounterpartyService) {}

  @Get()
  @Roles('admin', 'director', 'manager')
  list(
    @Query('page') page = '1',
    @Query('limit') limit = '50',
    @Query('search') search?: string,
    @Query('role') role?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.service.findAll(
      { page: parseInt(page, 10), limit: parseInt(limit, 10), search, role },
      user
        ? { organizationId: user.organizationId, role: user.role }
        : undefined,
    );
  }

  @Get(':id')
  @Roles('admin', 'director', 'manager', 'user')
  findOne(@Param('id') id: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.service.findById(id, user);
  }

  @Post('quick')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'Counterparty' })
  quickCreate(@Body() dto: QuickCreatePartyDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.service.quickCreateParty(dto, user);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'Counterparty' })
  create(@Body() dto: CreateCounterpartyDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'Counterparty', idParam: 'id' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCounterpartyDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'Counterparty', idParam: 'id' })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.service.remove(id, user);
  }
}
