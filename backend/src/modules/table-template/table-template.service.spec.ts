import type { Model } from 'mongoose';
import {
  type TableTemplateDocument,
} from './table-template.schema';
import { TableTemplateService } from './table-template.service';

describe('TableTemplateService (TZ-SALES-335)', () => {
  it('renders an image cell for the existing photo column', async () => {
    const model = {
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: 'table-1',
          columns: [
            { key: 'photo', label: 'Рисунок', type: 'text', align: 'left' },
            {
              key: 'quantity',
              label: 'Кол-во',
              type: 'number',
              align: 'right',
            },
          ],
        }),
      }),
    } as unknown as Model<TableTemplateDocument>;
    const service = new TableTemplateService(model);

    const html = await service.preview('507f1f77bcf86cd799439011', [
      [{ kind: 'image', url: '/uploads/stand-thumb.webp' }, 3],
    ]);

    expect(html).toContain(
      '<img src="/uploads/stand-thumb.webp" alt="" style="max-width:72px;max-height:48px;object-fit:contain" />',
    );
    expect(html).toContain('>3</td>');
  });

  it('TZ-QA-445C: photo column string URL becomes <img>; [img] placeholder → blank cell (TZ-NX-DOCSTUDIO-TABLE-PHOTO-EMPTY-BLANK)', async () => {
    const model = {
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: 'table-1',
          columns: [
            { key: 'photo', label: 'Фото', type: 'text', align: 'center' },
            { key: 'productName', label: 'Наименование', type: 'text', align: 'left' },
          ],
        }),
      }),
    } as unknown as Model<TableTemplateDocument>;
    const service = new TableTemplateService(model);

    const withUrl = await service.preview('507f1f77bcf86cd799439011', [
      ['/uploads/stand.webp', 'Стенд'],
    ]);
    expect(withUrl).toContain('<img src="/uploads/stand.webp"');
    expect(withUrl).not.toContain('[img]');

    const placeholder = await service.preview('507f1f77bcf86cd799439011', [
      ['[img]', 'Стенд'],
    ]);
    expect(placeholder).not.toContain('Нет фото');
    expect(placeholder).not.toContain('pi-photo-empty');
    expect(placeholder).not.toContain('[img]');
    expect(placeholder).not.toContain('<img');
  });

  it('does not render an unsafe image URL — blank cell, not «Нет фото» (TZ-NX-DOCSTUDIO-TABLE-PHOTO-EMPTY-BLANK)', async () => {
    const model = {
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: 'table-1',
          columns: [
            { key: 'photo', label: 'Рисунок', type: 'text', align: 'left' },
          ],
        }),
      }),
    } as unknown as Model<TableTemplateDocument>;
    const service = new TableTemplateService(model);

    const html = await service.preview('507f1f77bcf86cd799439011', [
      [{ kind: 'image', url: 'javascript:alert(1)' }],
    ]);

    expect(html).not.toContain('<img');
    expect(html).not.toContain('Нет фото');
    expect(html).not.toContain('pi-photo-empty');
    expect(html).toContain('border:1px solid #ccc');
  });

  it('renders an image cell for catalog photoIds column key', async () => {
    const model = {
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: 'table-1',
          columns: [
            { key: 'photoIds', label: 'Фото', type: 'text', align: 'left' },
            { key: 'name', label: 'Наименование', type: 'text', align: 'left' },
          ],
        }),
      }),
    } as unknown as Model<TableTemplateDocument>;
    const service = new TableTemplateService(model);

    const html = await service.preview('507f1f77bcf86cd799439011', [
      [{ kind: 'image', url: '/uploads/catalog.webp' }, 'Стенд'],
    ]);

    expect(html).toContain('<img src="/uploads/catalog.webp"');
    expect(html.match(/<th[^>]*>Фото<\/th>/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });

  it('hides the photo column without shifting the remaining row cells', async () => {
    const model = {
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: 'table-1',
          columns: [
            { key: 'photo', label: 'Фото', type: 'text', align: 'left' },
            { key: 'productName', label: 'Наименование', type: 'text', align: 'left' },
          ],
        }),
      }),
    } as unknown as Model<TableTemplateDocument>;
    const service = new TableTemplateService(model);

    const html = await service.preview(
      '507f1f77bcf86cd799439011',
      [['Стенд']],
      [
        { key: 'photo', visible: true },
        { key: 'productName', visible: true },
      ],
      undefined,
      { showPhotoColumn: false },
    );

    expect(html).not.toContain('<th scope="col" style="text-align:left;width:50%;font-weight:600;border:1px solid #ccc">Фото</th>');
    expect(html).toContain('>Стенд</td>');
    expect(html).not.toContain('<img');
  });

  it('applies request-only widthPercent and border/header chrome', async () => {
    const model = {
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: 'table-1',
          columns: [
            { key: 'productName', label: 'Наименование', type: 'text', align: 'left' },
            { key: 'quantity', label: 'Кол-во', type: 'number', align: 'right' },
          ],
        }),
      }),
    } as unknown as Model<TableTemplateDocument>;
    const service = new TableTemplateService(model);

    const html = await service.preview(
      '507f1f77bcf86cd799439011',
      [['Стенд', 2]],
      [
        { key: 'productName', visible: true, widthPercent: 70 },
        { key: 'quantity', visible: true, widthPercent: 30 },
      ],
      undefined,
      undefined,
      { borderWeight: 'thick', headerWeight: 'bold' },
    );

    expect(html).toContain('width:70%');
    expect(html).toContain('border:2px solid #ccc');
    expect(html).toContain('font-weight:700');
    expect(html).toContain('<colgroup>');
  });

  it('applies rowPresentation density/accent/separator/page-break/description/photoFit', async () => {
    const model = {
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: 'table-1',
          columns: [
            { key: 'productName', label: 'Наименование', type: 'text', align: 'left' },
            { key: 'photo', label: 'Рисунок', type: 'text', align: 'left' },
          ],
        }),
      }),
    } as unknown as Model<TableTemplateDocument>;
    const service = new TableTemplateService(model);

    const html = await service.preview(
      '507f1f77bcf86cd799439011',
      [
        [
          {
            kind: 'line-text',
            title: 'Первая',
            description: 'Скрыть меня',
          },
          { kind: 'image', url: '/uploads/a.webp' },
        ],
        [
          {
            kind: 'line-text',
            title: 'Вторая',
            description: 'Видно',
          },
          { kind: 'image', url: '/uploads/b.webp' },
        ],
      ],
      undefined,
      undefined,
      undefined,
      undefined,
      [
        {
          density: 'compact',
          emphasis: 'accent',
          separatorBefore: true,
          pageBreakBefore: true,
          showDescription: false,
          photoFit: 'cover',
        },
        {
          density: 'large',
          photoFit: 'contain',
        },
      ],
    );

    expect(html).toContain('background:#f3f3f0');
    expect(html).toContain('padding:2px 4px');
    expect(html).toContain('border-top:2px solid #333');
    expect(html).not.toContain('page-break-before:always');
    expect(html).not.toContain('Скрыть меня');
    expect(html).toContain('Видно');
    expect(html).toContain('object-fit:cover');
    expect(html).toContain('object-fit:contain');
    expect(html).toContain('padding:10px 8px');

    const htmlSecondBreak = await service.preview(
      '507f1f77bcf86cd799439011',
      [
        [{ kind: 'line-text', title: 'A' }],
        [{ kind: 'line-text', title: 'B' }],
      ],
      undefined,
      undefined,
      undefined,
      undefined,
      [{}, { pageBreakBefore: true }],
    );
    expect(htmlSecondBreak).toContain('page-break-before:always');
  });

  it('applies sheetLayout.tableFontSize to the preview table (TZ-SALES-373)', async () => {
    const model = {
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: 'table-1',
          columns: [
            { key: 'productName', label: 'Наименование', type: 'text', align: 'left' },
          ],
        }),
      }),
    } as unknown as Model<TableTemplateDocument>;
    const service = new TableTemplateService(model);

    const defaultHtml = await service.preview('507f1f77bcf86cd799439011', [
      ['Стенд'],
    ]);
    expect(defaultHtml).toContain('font-size:12px');

    const compactHtml = await service.preview(
      '507f1f77bcf86cd799439011',
      [['Стенд']],
      undefined,
      undefined,
      { tableFontSize: 9 },
    );
    expect(compactHtml).toMatch(/<td[^>]*font-size:9px/);
    expect(compactHtml).toMatch(/<th[^>]*font-size:12px/);

    const clampedHtml = await service.preview(
      '507f1f77bcf86cd799439011',
      [['Стенд']],
      undefined,
      undefined,
      { tableFontSize: 99 },
    );
    expect(clampedHtml).toMatch(/<td[^>]*font-size:20px/);
  });

  it('applies sheetLayout.tableHeaderFontSize to th separately from body (TZ-SALES-374)', async () => {
    const model = {
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: 'table-1',
          columns: [
            { key: 'productName', label: 'Наименование', type: 'text', align: 'left' },
          ],
        }),
      }),
    } as unknown as Model<TableTemplateDocument>;
    const service = new TableTemplateService(model);

    const html = await service.preview(
      '507f1f77bcf86cd799439011',
      [['Стенд']],
      undefined,
      undefined,
      { tableFontSize: 10, tableHeaderFontSize: 14 },
    );
    expect(html).toMatch(/<th[^>]*font-size:14px/);
    expect(html).toMatch(/<td[^>]*font-size:10px/);

    const clampedHeader = await service.preview(
      '507f1f77bcf86cd799439011',
      [['Стенд']],
      undefined,
      undefined,
      { tableHeaderFontSize: 99 },
    );
    expect(clampedHeader).toMatch(/<th[^>]*font-size:20px/);
  });
});
