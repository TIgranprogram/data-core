import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportJobsService } from './import-jobs.service';
import { CreateImportJobDto } from './dto/create-import-job.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';

@Controller('import-jobs')
export class ImportJobsController {
  constructor(private readonly service: ImportJobsService) {}

  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('entityType') entityType?: string,
  ) {
    return this.service.findAll(status, entityType);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'ImportJobs' })
  create(@Body() dto: CreateImportJobDto) {
    return this.service.create(dto);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @Roles('admin', 'manager')
  @AuditAction({ action: 'upload', entityType: 'ImportJobs' })
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: Omit<CreateImportJobDto, 'sourceFile'>,
  ) {
    const job = await this.service.create({
      ...body,
      sourceFile: file?.path ?? file?.originalname,
    });
    return job;
  }

  @Post(':id/start')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'start', entityType: 'ImportJobs' })
  start(@Param('id') id: string, @Body() body: { content?: string }) {
    return this.service.start(id, body?.content);
  }

  @Post(':id/cancel')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'cancel', entityType: 'ImportJobs' })
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @AuditAction({ action: 'delete', entityType: 'ImportJobs' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
