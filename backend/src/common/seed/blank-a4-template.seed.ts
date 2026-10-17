import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Organization,
  OrganizationDocument,
} from '../../modules/organization/organization.schema';
import { DocumentTemplateService } from '../../modules/document-template/document-template.service';

/**
 * TZ-DOC-STUDIO-2004 — per-org sentinel DocumentTemplate «Пустой A4».
 *
 * Idempotent: `ensureBlankA4Sentinel` finds or creates by org + sentinel tag.
 * Runs for all existing organizations on boot so blank studio finalize works
 * without requiring `sourceTemplateId` on the studio document.
 */
@Injectable()
export class BlankA4TemplateSeed implements OnModuleInit {
  private readonly logger = new Logger(BlankA4TemplateSeed.name);

  constructor(
    @InjectModel(Organization.name)
    private readonly orgModel: Model<OrganizationDocument>,
    private readonly templateService: DocumentTemplateService,
  ) {}

  async onModuleInit(): Promise<void> {
    const orgs = await this.orgModel.find().select('_id').lean().exec();
    for (const org of orgs) {
      try {
        await this.templateService.ensureBlankA4Sentinel(String(org._id));
      } catch (err) {
        this.logger.warn(
          `Could not seed blank A4 sentinel for org ${String(org._id)}: ${(err as Error).message}`,
        );
      }
    }
    if (orgs.length > 0) {
      this.logger.log(`Blank A4 sentinel ensured for ${orgs.length} organization(s)`);
    }
  }
}
