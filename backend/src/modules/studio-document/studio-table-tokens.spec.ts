import {
  applyTableAggregateTokensToBlocks,
  resolveTableAggregateTokens,
  tableAggregateValue,
} from './studio-table-tokens';

describe('studio-table-tokens (TZ-NX-DOCSTUDIO-S21)', () => {
  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'sum', label: 'Sum', type: 'sum' },
  ];

  it('computes subtotal, vat and grand', () => {
    const rows = [['A', '100'], ['B', '50']];
    expect(tableAggregateValue(columns, rows, 'subtotal', 20)).toBe(150);
    expect(tableAggregateValue(columns, rows, 'vat', 20)).toBe(30);
    expect(tableAggregateValue(columns, rows, 'grand', 20)).toBe(180);
  });

  it('replaces table aggregate tokens in text content', () => {
    const blocks = [
      { _id: 'block1', type: 'table', settings: { tableTemplateColumns: columns } },
      { _id: 'text1', type: 'text', content: 'Итого: {{table.subtotal}}' },
    ] as never[];
    const dataSets = [{ key: 'table-block1', rows: [['A', '1000']] }];
    const next = resolveTableAggregateTokens(
      'Итого: {{table.subtotal}}',
      blocks,
      dataSets,
      20,
    );
    expect(next).toContain('1');
    expect(next).not.toContain('{{table.subtotal}}');
  });
});

describe('applyTableAggregateTokensToBlocks — Mongoose Document layout drop (TZ-NX-DOCSTUDIO-S37C)', () => {
  /**
   * Reproduces the shape `findAllByStudioDocument` actually returns: a hydrated
   * Mongoose Document (not `.lean()`), where `layout` is exposed via a getter on
   * the prototype rather than as the instance's own enumerable property. That's
   * exactly what makes `{...block}` (no `.toObject()`) silently drop it — object
   * spread only copies own enumerable properties, and a proto getter isn't one.
   * `constructor.name === 'model'` matches what was observed live off the real
   * Mongoose instance during root-cause diagnosis.
   */
  class FakeMongooseTextBlock {
    readonly _id: string;
    readonly type = 'text' as const;
    readonly content: string;
    private readonly _layout: Record<string, unknown>;

    constructor(data: { _id: string; content: string; layout: Record<string, unknown> }) {
      this._id = data._id;
      this.content = data.content;
      this._layout = data.layout;
    }

    get layout(): Record<string, unknown> {
      return this._layout;
    }

    toObject(): Record<string, unknown> {
      return { _id: this._id, type: this.type, content: this.content, layout: this._layout };
    }
  }
  Object.defineProperty(FakeMongooseTextBlock, 'name', { value: 'model' });

  it('fixture sanity: spreading the fake document alone already loses layout, .toObject() keeps it', () => {
    const layout = { page: 1, x: 0.1, y: 0.1, width: 0.3, height: 0.1, zIndex: 1, rotation: 0 };
    const block = new FakeMongooseTextBlock({ _id: 'b1', content: 'Hello', layout });

    expect(block.layout).toEqual(layout);
    expect({ ...(block as unknown as object) }).not.toHaveProperty('layout');
    expect(block.toObject()).toHaveProperty('layout', layout);
  });

  it('keeps layout on the returned block when given a hydrated Mongoose document', () => {
    const layout = { page: 1, x: 0.35, y: 0.44, width: 0.3, height: 0.12, zIndex: 1, rotation: 0 };
    const block = new FakeMongooseTextBlock({
      _id: 'b1',
      content: '<p>{{counterparty.name}}</p>',
      layout,
    });

    const result = applyTableAggregateTokensToBlocks([block as never], [], 20);

    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty('layout', layout);
    expect(result[0].content).toContain('{{counterparty.name}}');
  });
});
