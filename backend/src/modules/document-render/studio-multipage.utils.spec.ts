import { Types } from 'mongoose';
import type { TemplateBlockDocument } from '../template-block/template-block.schema';
import {
  buildStudioTableHtml,
  planStudioMultipage,
} from './studio-multipage.utils';

function tableBlock(
  id: string,
  page: number,
): TemplateBlockDocument {
  return {
    _id: new Types.ObjectId(id),
    type: 'table',
    order: 0,
    showLine: false,
    isActive: true,
    settings: {
      tableTemplateColumns: [
        { key: 'name', label: 'Name' },
        { key: 'qty', label: 'Qty' },
      ],
    },
    layout: { page, x: 0.1, y: 0.2, width: 0.8, height: 0.3, zIndex: 1, rotation: 0 },
  } as unknown as TemplateBlockDocument;
}

describe('studio-multipage.utils (TZ-DOC-STUDIO-1701)', () => {
  it('buildStudioTableHtml renders columns and rows', () => {
    const html = buildStudioTableHtml(
      [{ key: 'a', label: 'A' }],
      [['hello']],
    );
    expect(html).toContain('pi-table');
    expect(html).toContain('hello');
  });

  it('plans manual pages with per-page background index', () => {
    const textBlock = {
      type: 'text',
      order: 0,
      showLine: false,
      isActive: true,
      content: '<p>Page 2</p>',
      layout: { page: 2, x: 0.1, y: 0.1, width: 0.5, zIndex: 1, rotation: 0 },
    } as unknown as TemplateBlockDocument;

    const plan = planStudioMultipage({
      blocks: [textBlock],
      manualPageCount: 2,
      dataSets: [],
      backgroundImages: ['/bg1.png', '/bg2.png'],
      defaultBackgroundIndex: 0,
    });

    expect(plan).toHaveLength(2);
    expect(plan[0].blocks).toHaveLength(0);
    expect(plan[1].blocks).toHaveLength(1);
    expect(plan[0].backgroundIndex).toBe(0);
    expect(plan[1].backgroundIndex).toBe(1);
  });

  it('uses configured first-page row capacity', () => {
    const blockId = '507f1f77bcf86cd799439011';
    const rows = Array.from({ length: 8 }, (_, i) => [`Row ${i}`, `${i}`]);
    const plan = planStudioMultipage({
      blocks: [tableBlock(blockId, 1)],
      manualPageCount: 1,
      dataSets: [{ key: `table-${blockId}`, rows }],
      backgroundImages: [],
      defaultBackgroundIndex: -1,
      sheetLayout: { rowsFirstPage: 5, rowsNextPage: 5 },
    });
    expect(plan[0].blocks[0]?.content).toContain('Row 4');
    expect(plan[0].blocks[0]?.content).not.toContain('Row 5');
  });

  it('splits overflowing table rows across pages', () => {
    const blockId = '507f1f77bcf86cd799439011';
    const manyRows = Array.from({ length: 30 }, (_, i) => [`Row ${i}`, `${i}`]);
    const plan = planStudioMultipage({
      blocks: [tableBlock(blockId, 1)],
      manualPageCount: 1,
      dataSets: [
        {
          key: `table-${blockId}`,
          rows: manyRows,
        },
      ],
      backgroundImages: [],
      defaultBackgroundIndex: -1,
    });

    expect(plan.length).toBeGreaterThan(1);
    const tablePages = plan.filter((page) =>
      page.blocks.some((block) => block.type === 'table'),
    );
    expect(tablePages.length).toBeGreaterThan(1);
  });

  /**
   * TZ-NX-DOCSTUDIO-S42 — cloneBlock (internal, exercised via overflow here)
   * used `{...block, ...patch}` directly. For a hydrated Mongoose Document
   * (own paths exposed via prototype getters, not own enumerable properties —
   * matches the real findAllByStudioDocument shape, constructor.name === 'model'
   * as observed live during S37C diagnosis), that spread silently drops every
   * field not explicitly in `patch` — not just `layout`. The plain-object
   * fixtures used by the other tests in this file can't catch that class of
   * defect, so this one uses a fixture shaped like the real thing.
   */
  class FakeMongooseTableBlock {
    readonly _id: Types.ObjectId;
    readonly type = 'table' as const;
    readonly order = 0;
    private readonly _showLine = false;
    private readonly _isActive = true;
    private readonly _settings: Record<string, unknown>;
    private readonly _layout: Record<string, unknown>;

    constructor(data: {
      _id: Types.ObjectId;
      settings: Record<string, unknown>;
      layout: Record<string, unknown>;
    }) {
      this._id = data._id;
      this._settings = data.settings;
      this._layout = data.layout;
    }

    get showLine(): boolean {
      return this._showLine;
    }

    get isActive(): boolean {
      return this._isActive;
    }

    get settings(): Record<string, unknown> {
      return this._settings;
    }

    get layout(): Record<string, unknown> {
      return this._layout;
    }

    toObject(): Record<string, unknown> {
      return {
        _id: this._id,
        type: this.type,
        order: this.order,
        showLine: this._showLine,
        isActive: this._isActive,
        settings: this._settings,
        layout: this._layout,
      };
    }
  }
  Object.defineProperty(FakeMongooseTableBlock, 'name', { value: 'model' });

  it('fixture sanity: spreading the fake document alone loses everything not an own property', () => {
    const block = new FakeMongooseTableBlock({
      _id: new Types.ObjectId(),
      settings: { tableTemplateColumns: [{ key: 'name', label: 'Name' }] },
      layout: { page: 1, x: 0.1, y: 0.2, width: 0.8, height: 0.3, zIndex: 1, rotation: 0 },
    });
    expect(block.isActive).toBe(true);
    expect(block.settings).toBeDefined();
    expect({ ...(block as unknown as object) }).not.toHaveProperty('isActive');
    expect({ ...(block as unknown as object) }).not.toHaveProperty('settings');
    expect(block.toObject()).toHaveProperty('isActive', true);
  });

  it('keeps non-patched fields (isActive, settings) on the cloned continuation-page block', () => {
    const blockId = new Types.ObjectId();
    const block = new FakeMongooseTableBlock({
      _id: blockId,
      settings: {
        tableTemplateColumns: [
          { key: 'name', label: 'Name' },
          { key: 'qty', label: 'Qty' },
        ],
      },
      layout: { page: 1, x: 0.1, y: 0.2, width: 0.8, height: 0.3, zIndex: 1, rotation: 0 },
    });
    const manyRows = Array.from({ length: 30 }, (_, i) => [`Row ${i}`, `${i}`]);

    const plan = planStudioMultipage({
      blocks: [block as unknown as TemplateBlockDocument],
      manualPageCount: 1,
      dataSets: [{ key: `table-${blockId.toString()}`, rows: manyRows }],
      backgroundImages: [],
      defaultBackgroundIndex: -1,
    });

    expect(plan.length).toBeGreaterThan(1);
    const continuation = plan[1]?.blocks.find((b) => b.type === 'table');
    expect(continuation).toBeDefined();
    expect(continuation).toHaveProperty('isActive', true);
    expect(continuation).toHaveProperty('settings');
    expect((continuation?.settings as { tableTemplateColumns?: unknown[] })?.tableTemplateColumns).toHaveLength(2);
    expect(continuation?.layout?.page).toBe(2);
  });
});
