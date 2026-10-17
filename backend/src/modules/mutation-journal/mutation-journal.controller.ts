import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { AuditAction } from '../../common/interceptors/audit.interceptor';
import {
  CreateProposalDto,
  ProposeBatchDto,
  ProposalIdsBatchDto,
} from './dto/create-proposal.dto';
import { MutationJournalService } from './mutation-journal.service';

@ApiTags('Mutation journal (MCP propose/confirm)')
@Controller('mutation-journal')
export class MutationJournalController {
  constructor(private readonly service: MutationJournalService) {}

  @Post('proposals')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'MutationJournal' })
  @ApiOperation({ summary: 'Propose a material create/update (no SoT write yet)' })
  propose(@Body() dto: CreateProposalDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.propose(dto, user);
  }

  @Post('propose-batch')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'MutationJournal' })
  @ApiOperation({
    summary: 'TZD-18 — batch propose (all-or-nothing best-effort; no SoT write)',
  })
  proposeBatch(
    @Body() dto: ProposeBatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.proposeBatch(dto, user);
  }

  @Post('confirm-batch')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'MutationJournal' })
  @ApiOperation({ summary: 'TZD-18 — batch confirm (applies materials via journal)' })
  confirmBatch(
    @Body() dto: ProposalIdsBatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.confirmBatch(dto, user);
  }

  @Post('cancel-batch')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'TZD-18 — batch cancel (no SoT change)' })
  cancelBatch(
    @Body() dto: ProposalIdsBatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.cancelBatch(dto, user);
  }

  @Post('proposals/:id/confirm')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'MutationJournal', idParam: 'id' })
  @ApiOperation({ summary: 'Confirm proposal → apply Material API + journal applied' })
  confirm(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.confirm(id, user);
  }

  @Post('proposals/:id/cancel')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Cancel a pending proposal' })
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.cancel(id, user);
  }

  @Post('undo-last')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Undo the most recent applied mutation for this actor/org' })
  undoLast(@CurrentUser() user: AuthenticatedUser) {
    return this.service.undoLast(user);
  }

  @Post(':id/undo')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'update', entityType: 'MutationJournal', idParam: 'id' })
  @ApiOperation({ summary: 'Undo an applied mutation (within ring)' })
  undo(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.undo(id, user);
  }

  @Get()
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'List recent applied/undone journal entries' })
  @ApiQuery({ name: 'limit', required: false })
  list(@Query('limit') limit = '20', @CurrentUser() user: AuthenticatedUser) {
    return this.service.listRecent(user, parseInt(limit, 10));
  }

  @Get(':id')
  @Roles('admin', 'manager')
  @ApiOperation({ summary: 'Get proposal or mutation by id' })
  getOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.getById(id, user);
  }
}
