import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { Model, Types } from 'mongoose';
import { inlineLocalUploadsForPdf } from '../document-render/document-render.utils';
import { PdfSemaphore } from '../../common/pdf/pdf-semaphore';
import { Quotation, QuotationDocument } from '../quotation/quotation.schema';
import { DocumentTemplateService } from '../document-template/document-template.service';
import { BuildDocumentDto } from '../document-template/dto/build-document.dto';
import { GeneratedDocumentService } from './generated-document.service';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

type OutputUser = Pick<AuthenticatedUser, 'organizationId'>;

type RenderedQuotation = {
  quotation: QuotationDocument;
  html: string;
  buildPayload: BuildDocumentDto;
  templateId: string;
};

@Injectable()
export class QuotationOutputService {
  private readonly logger = new Logger(QuotationOutputService.name);
  private browserPromise: Promise<Browser> | null = null;
  private readonly pdfSemaphore = new PdfSemaphore(
    Math.max(1, Number(process.env.PDF_MAX_CONCURRENT ?? 2)),
  );

  constructor(
    @InjectModel(Quotation.name)
    private readonly quotationModel: Model<QuotationDocument>,
    private readonly templateService: DocumentTemplateService,
    private readonly generatedDocuments: GeneratedDocumentService,
  ) {}

  async renderPdf(
    id: string,
    user?: OutputUser,
  ): Promise<{ buffer: Buffer; number: string }> {
    // TZ-QA-445C: always rebuild from current quotation items so product
    // photos are not lost behind a stale templateSnapshot.html freeze.
    const rendered = await this.renderQuotation(id, user, {
      preferLiveRebuild: true,
    });
    const buffer = await this.renderHtmlToPdf(rendered.html);
    return { buffer, number: rendered.quotation.number };
  }

  /** Shared HTML → PDF pipeline (Wave 10 studio reuse). */
  async renderHtmlToPdf(html: string): Promise<Buffer> {
    const release = await this.pdfSemaphore.acquire();
    const startedAt = Date.now();
    try {
      const buffer = await this.renderHtmlToPdfInner(html);
      const durationMs = Date.now() - startedAt;
      this.logger.log(`PDF render completed in ${durationMs}ms`);
      return buffer;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`PDF render failed after ${durationMs}ms: ${message}`);
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(
        'Сервис печати недоступен, используйте Печать в браузере.',
        { cause: error instanceof Error ? error : undefined },
      );
    } finally {
      release();
    }
  }

  private async renderHtmlToPdfInner(html: string): Promise<Buffer> {
    const htmlForPdf = await inlineLocalUploadsForPdf(html);
    const browser = await this.getBrowser();
    let page: Page | undefined;
    try {
      page = await browser.newPage();
      await page.setContent(this.withPdfBaseHref(htmlForPdf), {
        waitUntil: 'load',
        timeout: 15_000,
      });
      const evaluate = (page as unknown as {
        evaluate?: (pageFunction: () => Promise<void>) => Promise<void>;
      }).evaluate;
      if (typeof evaluate === 'function') {
        await evaluate.call(page, async () => {
          const images = Array.from(document.images);
          await Promise.all(
            images.map(
              (image) =>
                image.complete
                  ? Promise.resolve()
                  : new Promise<void>((resolve) => {
                      const timer = window.setTimeout(resolve, 3_000);
                      image.addEventListener('load', () => {
                        window.clearTimeout(timer);
                        resolve();
                      }, { once: true });
                      image.addEventListener('error', () => {
                        window.clearTimeout(timer);
                        resolve();
                      }, { once: true });
                    }),
            ),
          );
        });
        await this.waitForDocumentFonts(page);
      }
      return Buffer.from(
        await page.pdf({
          format: this.pageFormat(html),
          landscape: this.isLandscape(html),
          printBackground: true,
          preferCSSPageSize: true,
          margin: { top: '0', right: '0', bottom: '0', left: '0' },
        }),
      );
    } finally {
      await page?.close().catch(() => undefined);
    }
  }

  async archive(
    id: string,
    user?: OutputUser,
  ): Promise<Record<string, unknown>> {
    const rendered = await this.renderQuotation(id, user);
    const doc = await this.generatedDocuments.archiveRendered({
      templateId: rendered.templateId,
      templateName: `КП ${rendered.quotation.number}`,
      name: `КП ${rendered.quotation.number}`,
      sourceId: rendered.quotation._id,
      organizationId: this.organizationId(rendered.quotation),
      html: rendered.html,
      buildPayload: rendered.buildPayload as unknown as Record<string, unknown>,
    });
    return doc.toObject() as unknown as Record<string, unknown>;
  }

  async onApplicationShutdown(): Promise<void> {
    const browser = this.browserPromise
      ? await this.browserPromise.catch(() => null)
      : null;
    this.browserPromise = null;
    await browser?.close().catch(() => undefined);
  }

  private async renderQuotation(
    id: string,
    user?: OutputUser,
    opts?: { preferLiveRebuild?: boolean },
  ): Promise<RenderedQuotation> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`КП ${id} не найдено`);
    }
    const quotation = await this.quotationModel.findById(id).exec();
    if (!quotation || quotation.deletedAt) {
      throw new NotFoundException(`КП ${id} не найдено`);
    }
    const quotationOrganizationId = this.organizationId(quotation);
    if (
      user?.organizationId &&
      quotationOrganizationId !== user.organizationId
    ) {
      throw new NotFoundException(`КП ${id} не найдено`);
    }

    const snapshot = quotation.templateSnapshot as
      Record<string, unknown> | undefined;
    const snapshotHtml = snapshot?.['html'];
    const templateId = this.templateIdOf(quotation.templateId, snapshot);
    if (
      !opts?.preferLiveRebuild &&
      typeof snapshotHtml === 'string' &&
      snapshotHtml.trim() &&
      templateId
    ) {
      return {
        quotation,
        html: snapshotHtml,
        buildPayload: this.buildPayload(quotation, snapshot),
        templateId,
      };
    }
    if (!templateId) {
      throw new BadRequestException(
        'У КП нет шаблона для печати. Выберите шаблон и сохраните КП.',
      );
    }

    const template = await this.templateService.findById(templateId);
    const templateOrganizationId = this.referenceId(template.organizationId);
    if (
      templateOrganizationId &&
      templateOrganizationId !== quotationOrganizationId
    ) {
      throw new NotFoundException(`КП ${id} не найдено`);
    }
    const buildPayload = this.buildPayload(quotation, snapshot);
    if (user?.organizationId) {
      await this.templateService.assertBuildSourcesInOrganization(
        buildPayload,
        user.organizationId,
      );
    }
    const html = await this.templateService.build(templateId, buildPayload);
    return { quotation, html, buildPayload, templateId };
  }

  private buildPayload(
    quotation: QuotationDocument,
    snapshot?: Record<string, unknown>,
  ): BuildDocumentDto {
    const tableLayout = snapshot?.['tableLayout'];
    const tableTargetId = snapshot?.['tableTargetId'];
    const sheetLayout = snapshot?.['sheetLayout'];
    return {
      previewLines: (quotation.items ?? []).map((item) => ({
        ...(item.lineKind === 'custom' ? { lineKind: 'custom' as const } : {}),
        productName: item.productName ?? 'Изделие',
        ...(item.description ? { description: item.description } : {}),
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        ...(item.productSku ? { productSku: item.productSku } : {}),
        ...(item.photoUrl ? { photoUrl: item.photoUrl } : {}),
        ...(item.unit ? { unit: item.unit } : {}),
        ...(item.discountPercent ? { discountPercent: item.discountPercent } : {}),
        ...(item.isOptional ? { isOptional: true } : {}),
        ...(item.rowPresentation
          ? { rowPresentation: { ...item.rowPresentation } }
          : {}),
      })),
      ...(Array.isArray(tableLayout) ? { tableLayout } : {}),
      ...(typeof tableTargetId === 'string' ? { tableTargetId } : {}),
      ...(sheetLayout && typeof sheetLayout === 'object'
        ? { sheetLayout: sheetLayout as BuildDocumentDto['sheetLayout'] }
        : {}),
      terms: (quotation.terms ?? []).map((term, sortOrder) => ({
        text: term.text,
        sortOrder: term.sortOrder ?? sortOrder,
      })),
      dealTotals: {
        vatPercent: quotation.vatPercent ?? 20,
        discountType: quotation.discountType ?? 'none',
        discountPercent: quotation.discountPercent ?? 0,
        discountAmount: quotation.discountAmount ?? 0,
        prepaymentPercent: quotation.prepaymentPercent ?? 0,
        productionDays: quotation.productionDays ?? 0,
        deliveryDays: quotation.deliveryDays ?? 0,
      },
      organizationId: this.organizationId(quotation),
      ...(quotation.counterpartyId
        ? { counterpartyId: this.referenceId(quotation.counterpartyId) }
        : {}),
      ...(quotation.contactPersonId
        ? { contactPersonId: this.referenceId(quotation.contactPersonId) }
        : {}),
      ...(quotation.siteId
        ? { siteId: this.referenceId(quotation.siteId) }
        : {}),
      proposalNumber: quotation.number,
      proposalDate: quotation.date?.toISOString(),
      ...(quotation.validUntil
        ? { validUntil: quotation.validUntil.toISOString() }
        : {}),
      totalPrice: quotation.total ?? 0,
      quotationId: quotation._id.toString(),
    };
  }

  private async waitForDocumentFonts(page: Page): Promise<void> {
    const timeoutMs = 5_000;
    const evaluate = page.evaluate;
    if (typeof evaluate !== 'function') return;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        evaluate.call(page, () => document.fonts.ready),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            timedOut = true;
            resolve();
          }, timeoutMs);
        }),
      ]);
      if (timer) clearTimeout(timer);
      if (timedOut) {
        this.logger.warn(`PDF font loading timed out after ${timeoutMs}ms; continuing with declared font stack`);
      }
    } catch (error) {
      if (timer) clearTimeout(timer);
      this.logger.warn(`PDF font loading failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browserPromise) return this.browserPromise;
    const executablePath = this.executablePath();
    if (!executablePath) {
      throw new ServiceUnavailableException(
        'Сервис печати недоступен, используйте Печать в браузере.',
      );
    }
    this.browserPromise = puppeteer
      .launch({
        executablePath,
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
        timeout: 5_000,
      })
      .catch((error: unknown) => {
        this.browserPromise = null;
        throw new ServiceUnavailableException(
          'Сервис печати недоступен, используйте Печать в браузере.',
          { cause: error instanceof Error ? error : undefined },
        );
      });
    return this.browserPromise;
  }

  private withPdfBaseHref(html: string): string {
    if (/<base\s/i.test(html)) return html;
    const configured = process.env.KPPDF_PUBLIC_ORIGIN ?? process.env.PUBLIC_BASE_URL ?? 'http://127.0.0.1:3000';
    let origin = 'http://127.0.0.1:3000';
    try {
      origin = new URL(configured).origin;
    } catch {
      // Keep the local backend default; invalid configuration must not create a raw URL.
    }
    const baseTag = `<base href="${origin}/">`;
    if (/<head[^>]*>/i.test(html)) {
      return html.replace(/<head[^>]*>/i, (open) => `${open}${baseTag}`);
    }
    return `<!DOCTYPE html><html><head>${baseTag}</head><body>${html}</body></html>`;
  }

  private executablePath(): string | undefined {
    const configured =
      process.env.PUPPETEER_EXECUTABLE_PATH ?? process.env.CHROME_PATH;
    if (configured?.trim()) return configured.trim();
    const candidates =
      process.platform === 'win32'
        ? [
            `${process.env.PROGRAMFILES ?? 'C:/Program Files'}/Google/Chrome/Application/chrome.exe`,
            `${process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)'}/Google/Chrome/Application/chrome.exe`,
            `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
          ]
        : process.platform === 'darwin'
          ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
          : [
              '/usr/bin/google-chrome',
              '/usr/bin/chromium',
              '/usr/bin/chromium-browser',
            ];
    return candidates.find((candidate) => candidate && existsSync(candidate));
  }

  private pageFormat(html: string): 'A4' | 'A3' {
    return /@page\s*\{[^}]*size:\s*A3/i.test(html) ? 'A3' : 'A4';
  }

  private isLandscape(html: string): boolean {
    return /@page\s*\{[^}]*size:\s*landscape/i.test(html);
  }

  private organizationId(quotation: QuotationDocument): string {
    return this.referenceId(quotation.organizationId);
  }

  private templateIdOf(
    templateId: unknown,
    snapshot?: Record<string, unknown>,
  ): string | null {
    const candidate = this.referenceId(templateId);
    if (candidate && Types.ObjectId.isValid(candidate)) return candidate;
    const snapshotId = snapshot?.['templateId'];
    return typeof snapshotId === 'string' && Types.ObjectId.isValid(snapshotId)
      ? snapshotId
      : null;
  }

  private referenceId(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && '_id' in value) {
      return String((value as { _id: unknown })._id);
    }
    return String(value ?? '');
  }
}
