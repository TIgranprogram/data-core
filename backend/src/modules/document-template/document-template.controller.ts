import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { RequireOrgScope } from '../../common/decorators/require-org-scope.decorator';
import { OrgScopeGuardInterceptor } from '../../common/interceptors/org-scope.interceptor';
import type { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { DocumentTemplateService } from './document-template.service';
import { CreateDocumentTemplateDto } from './dto/create-document-template.dto';
import { UpdateDocumentTemplateDto } from './dto/update-document-template.dto';
import { BuildDocumentDto } from './dto/build-document.dto';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { OwnerOnly } from '../../common/guards/ownership/ownership.decorator';
import { OwnershipGuard } from '../../common/guards/ownership/ownership.guard';
import type { AuthenticatedUserLike } from '../../common/contracts/rbac-contract';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';

/**
 * TZ-86 Phase A.4 — DocumentTemplateController extended.
 *
 * New route: `POST /api/document-templates/:id/build`
 *   body = `BuildDocumentDto` ({ organizationId?, counterpartyId?, etc. })
 *   response = `text/html; charset=utf-8` rendered document.
 *
 * No `@AuditAction` decorator on /build — render is read-only-ish (no DB
 * writes), AuditInterceptor matches only decorated metadata. Adding a
 * decorator here would pollute audit-log with every preview render.
 */
/**
 * TZ-251 §ШАГ 2 — Class-level `@UseGuards(OwnershipGuard)`.
 *
 * Registering the guard on the controller class ensures that EVERY route
 * goes through it. The guard internally short-circuits to `true` for
 * routes without `@OwnerOnly(...)` metadata (see `ownership.guard.ts` Step 1),
 * so this is safe even on un-protected endpoints.
 *
 * Order of guards (NestJS evaluation):
 *   1. JwtAuthGuard       (APP_GUARD, global)
 *   2. RolesGuard         (APP_GUARD, global)
 *   3. OwnershipGuard     (class-level @UseGuards)
 *
 * Each guard either passes or rejects with its own error code; OwnershipGuard
 * throws 401 (no user) or 404 (mismatch) — never 403, to avoid enumeration.
 */
@RequireOrgScope()
@UseInterceptors(OrgScopeGuardInterceptor)
@Controller('document-templates')
@UseGuards(OwnershipGuard)
export class DocumentTemplateController {
  constructor(private readonly service: DocumentTemplateService) {}

  /**
   * TZ-DOC-307 — `categoryId` query filter (optional). A template list can
   * be narrowed to one document-template category without weakening the
   * existing organization / docType / isDefault scoping.
   *
   * TZ-DOC-STUDIO-2003 — `organizationId` is always taken from the JWT
   * (`@CurrentUser()`), never from a client query param. Org-scoped users
   * cannot enumerate cross-org templates; system admin (null org) sees all.
   */
  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('docTypeId') docTypeId?: string,
    @Query('isDefault') isDefault?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.service.findAll(
      user.organizationId ?? undefined,
      docTypeId,
      isDefault === undefined ? undefined : isDefault === 'true',
      categoryId,
    );
  }

  /**
   * TZ-251 §ШАГ 2 — `:id` routes are guarded by OwnershipGuard.
   *
   * Guard order on each method: `[JwtAuthGuard, RolesGuard, OwnershipGuard]`
   * in app-wide registration order. Application-layer controllers do NOT
   * need to pass them via `@UseGuards()` because they are registered as
   * `APP_GUARD` providers in `app.module.ts`. The `@OwnerOnly` metadata
   * is the only thing this controller owns — the guard reads it via
   * Reflector and decides whether to enforce.
   *
   * NOTE: NestJS executes APP_GUARDs in registration order. Our order is:
   *   1. JwtAuthGuard       (401 if no valid JWT)
   *   2. RolesGuard         (403 if @Roles mismatch)
   *   3. OwnershipGuard     (404 if ownership mismatch)
   *
   * This sequence gives the user the most informative 4xx when something
   * is wrong without leaking existence of unowned resources.
   */

  @Get(':id')
  @OwnerOnly('documentTemplate')
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Get(':id/expanded')
  @OwnerOnly('documentTemplate')
  expanded(@Param('id') id: string) {
    return this.service.findExpanded(id);
  }

  /**
   * TZ-86 Phase A.4 — DataBinding-aware HTML build.
   * Returns inline HTML (text/html). Service injects resolved sourceIds
   * via parallel Mongoose lookups before delegating to existing renderHtml.
   *
   * TZ-251 §ШАГ 2 — `@OwnerOnly` here enforces that only the owner (or
   * admin wildcard) can render the template via this caller-supplied
   * data binding flow (which can reach external documents and tokens).
   */
  @Post(':id/build')
  @Roles('admin', 'manager')
  @OwnerOnly('documentTemplate')
  async build(
    @Param('id') id: string,
    @Body() dto: BuildDocumentDto,
    @Res() res: Response,
  ): Promise<void> {
    const html = await this.service.build(id, dto);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  /**
   * TZ-86 Phase A.6 — Upload background image (5 MB max, png|jpeg|webp).
   *
   * Multipart contract:
   *   - URL:    POST /api/document-templates/:id/upload-background
   *   - Field:  `file` (mandatory; required by FileInterceptor)
   *   - Limits: fileSize ≤ 5 MB, files ≤ 1, MIME ∈ {image/png, image/jpeg, image/webp}
   *   - Body:   nothing else (Auth header carries JWT).
   *
   * Response: `{ url: '/uploads/...', backgroundImage: string[] }`.
   *
   * Validation:
   *   - FileFilter rejects non-whitelisted MIMEs → BadRequestException → 400.
   *   - limit.fileSize triggers MulterError('LIMIT_FILE_SIZE') → caught by
   *     `MulterExceptionFilter` (registered in main.ts) → 413 Payload Too Large.
   *   - Service enforces MAX_BACKGROUND_IMAGES=5 → 409 Conflict on overflow.
   *   - Template not found → 404 (DocumentTemplateService.findById throws).
   *
   * Storage strategy: `memoryStorage()` so the buffer sits in RAM until the
   * service has validated the template ID and 5-image cap. Then we write the
   * file manually under `uploads/document-templates/{id}/{uuidv4}.{ext}` —
   * main.ts's `useStaticAssets` exposes those URLs at `/uploads/*`.
   */
  @Post(':id/upload-background')
  @Roles('admin', 'manager')
  @OwnerOnly('documentTemplate')
  @AuditAction({ action: 'upload_background', entityType: 'DocumentTemplate' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_req, file, cb) => {
        const allowed = ['image/png', 'image/jpeg', 'image/webp'];
        if (!allowed.includes(file.mimetype)) {
          return cb(
            new BadRequestException(
              `Недопустимый MIME-тип файла: ${file.mimetype}. Разрешено: image/png | image/jpeg | image/webp.`,
            ),
            false,
          );
        }
        cb(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  async uploadBackground(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ url: string; backgroundImage: string[] }> {
    if (!file) {
      throw new BadRequestException(
        'Файл не получен. Выберите PNG, JPEG или WebP (поле «file»).',
      );
    }
    const url = await this.service.uploadBackground(id, file);
    const template = await this.service.findById(id);
    return { url, backgroundImage: template.backgroundImage };
  }

  /**
   * TZ-251 §ШАГ 2 — `create()` reads `req.user.id` (populated by JWT
   * strategy) and forwards it to `service.create(dto, userId)`, which
   * tags the new template with `createdBy = userId`. Existing callers
   * that pass only `dto` still work because `userId` is optional — the
   * legacy-fallback branch in OwnershipGuard covers unowned documents.
   */
  @Post()
  @Roles('admin', 'manager')
  @AuditAction({ action: 'create', entityType: 'DocumentTemplate' })
  create(
    @Body() dto: CreateDocumentTemplateDto,
    @Req() req: Request & { user?: AuthenticatedUserLike },
  ) {
    return this.service.create(dto, req.user?.id);
  }

  @Patch(':id')
  @Roles('admin', 'manager')
  @OwnerOnly('documentTemplate')
  @AuditAction({ action: 'update', entityType: 'DocumentTemplate' })
  update(@Param('id') id: string, @Body() dto: UpdateDocumentTemplateDto) {
    return this.service.update(id, dto);
  }

  /**
   * TZ-251 §ШАГ 2 — duplicate enforces ownership of the SOURCE template.
   * The newly created copy's `createdBy` is set to the ACTING user in
   * `service.duplicate(id, userId)`.
   */
  @Post(':id/duplicate')
  @Roles('admin', 'manager')
  @OwnerOnly('documentTemplate')
  @AuditAction({ action: 'duplicate', entityType: 'DocumentTemplate' })
  duplicate(
    @Param('id') id: string,
    @Req() req: Request & { user?: AuthenticatedUserLike },
  ) {
    return this.service.duplicate(id, req.user?.id);
  }

  @Post(':id/set-default')
  @Roles('admin', 'manager')
  @OwnerOnly('documentTemplate')
  @AuditAction({ action: 'set_default', entityType: 'DocumentTemplate' })
  setDefault(@Param('id') id: string) {
    return this.service.setDefault(id);
  }

  @Get(':id/preview')
  @OwnerOnly('documentTemplate')
  async preview(
    @Param('id') id: string,
    @Query('dataId') dataId: string | undefined,
    @Res() res: Response,
  ) {
    const html = await this.service.preview(id, dataId);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Delete(':id')
  @Roles('admin', 'manager')
  @OwnerOnly('documentTemplate')
  @AuditAction({ action: 'delete', entityType: 'DocumentTemplate' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Delete(':id/backgrounds/:index')
  @Roles('admin', 'manager')
  @OwnerOnly('documentTemplate')
  @AuditAction({ action: 'remove_background', entityType: 'DocumentTemplate' })
  removeBackground(
    @Param('id') id: string,
    @Param('index') index: string,
  ) {
    return this.service.removeBackground(id, parseInt(index, 10));
  }

  @Patch(':id/backgrounds/default')
  @Roles('admin', 'manager')
  @OwnerOnly('documentTemplate')
  @AuditAction({ action: 'set_default_background', entityType: 'DocumentTemplate' })
  setDefaultBackground(
    @Param('id') id: string,
    @Body('index') index: number,
  ) {
    return this.service.setDefaultBackground(id, index);
  }

  @Patch(':id/orientation')
  @Roles('admin', 'manager')
  @OwnerOnly('documentTemplate')
  @AuditAction({ action: 'set_orientation', entityType: 'DocumentTemplate' })
  setOrientation(
    @Param('id') id: string,
    @Body('orientation') orientation: 'portrait' | 'landscape',
  ) {
    return this.service.setOrientation(id, orientation);
  }
}
