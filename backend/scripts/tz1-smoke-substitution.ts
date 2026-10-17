/**
 * TZ-NX-DOCSTUDIO-S8-1 — AC smoke: doc.context.counterpartyId + {{counterparty.inn}}
 * token → preview HTML substitutes real DB value. Uses real DocumentRenderService
 * and the real hydration path (buildSubstitutionBag mocked at the service seam,
 * since this script runs outside Nest DI).
 */
import { Types } from 'mongoose';
import { DocumentRenderService } from '../src/modules/document-render/document-render.service';
import { studioAggregateToRenderInput } from '../src/modules/document-render/studio-render.adapter';
import type { StudioDocumentAggregate } from '../src/modules/document-render/studio-render.adapter';

const DOC = {
  name: 'Документ 29.08.2026',
  pageSize: 'A4' as const,
  orientation: 'portrait' as const,
  backgroundImage: [],
  defaultBackgroundIndex: -1,
  backgroundOpacity: 0.3,
  pageNumbering: false,
  manualPageCount: 1,
};

// Real block content from DB (doc 6a91ff188c239129847b6864)
const blocks = [{
  _id: new Types.ObjectId(),
  type: 'text',
  order: 0,
  isActive: true,
  showLine: false,
  content: '<p><span>{{product.photoIds}}</span>Новый<span>{{counterparty.inn}}</span> текст</p>',
  layout: { page: 1, x: 0.1, y: 0.1, width: 0.8, zIndex: 1, rotation: 0 },
}] as never[];

// Real bag shape returned by buildSubstitutionBag (values from counterparties
// collection: cp 6a81c3ef107c9fceaf1e5c88 «Загородный Дом»)
const bag = { counterparty: { name: 'ООО «Загородный Дом»', shortName: 'Загородный Дом', inn: '3664069397' } };

const aggregate: StudioDocumentAggregate = { document: DOC, blocks, buildDto: {}, dataSets: [], data: bag };
const input = studioAggregateToRenderInput(aggregate);
const html = new DocumentRenderService().renderHtml(input.template, input.blocks, input.data, { studioCanvas: true });

const inn = '3664069397';
const checks = [
  ['INN substituted', html.includes(inn)],
  ['no raw counterparty token', !html.includes('{{counterparty')],
  ['no raw product token', !html.includes('{{product')],
  ['empty substitution for missing key', !html.includes('undefined')],
];
let fail = false;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} · ${label}`);
  if (!ok) fail = true;
}
process.exit(fail ? 1 : 0);
