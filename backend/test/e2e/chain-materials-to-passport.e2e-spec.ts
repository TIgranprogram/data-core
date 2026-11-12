import request from 'supertest';
import sharp from 'sharp';
import { Types } from 'mongoose';
import { promises as fs } from 'fs';
import { dirname, resolve } from 'path';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';
import { createTestApp, type TestContext } from '../setup/test-db';

const binary = (stream: NodeJS.ReadableStream, done: (error: Error | null, body: Buffer) => void) => {
  const parts: Buffer[] = [];
  stream.on('data', (part: Buffer) => parts.push(part));
  stream.on('end', () => done(null, Buffer.concat(parts)));
  stream.on('error', (error: Error) => done(error, Buffer.alloc(0)));
};

/** PDFKit добавляет дату создания и ID файла при каждой печати. Остальной PDF должен совпасть. */
const withoutPdfMetadata = (pdf: Buffer) => pdf.toString('latin1')
  .replace(/\(D:\d{14}Z\)/g, '(D:00000000000000Z)')
  .replace(/\/ID\s*\[<[0-9a-f]+>\s*<[0-9a-f]+>\]/gi, '/ID []');

describe('МИ.6 / МЦ-7: закупка → состав изделия → паспорт', () => {
  let ctx: TestContext | undefined;
  let access: string;
  const http = () => request(ctx!.app.getHttpServer());
  const auth = () => authHeader(access);
  const db = () => ctx!.connection.db!;
  const fileName = `e2e-material-chain-${new Types.ObjectId()}.png`;
  const imagePath = resolve(process.env.UPLOAD_DIR || 'uploads', fileName);
  const findPassport = async (id: string) => (await http().get(`/api/passports/${id}`).set(auth()).expect(200)).body;
  const pdf = async (id: string) => {
    const result = await http().get(`/api/passports/${id}/pdf`).set(auth())
      .buffer(true).parse(binary as never).expect('Content-Type', /application\/pdf/).expect(200);
    const body = result.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    return body;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    access = (await loginAsAdmin(ctx.app)).access;
    await fs.mkdir(dirname(imagePath), { recursive: true });
    await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).png().toFile(imagePath);
  });

  afterAll(async () => {
    await ctx?.cleanup();
    await fs.unlink(imagePath).catch(() => undefined);
  });

  it('принимает купленный материал, переносит выдачу в состав и печатает паспорт без перезаписи старого', async () => {
    const dict = db().collection('dict_values');
    const pipeId = String((await dict.insertOne({ dict: 'passportMaterials', code: 'QA_MC_PIPE', name: 'Труба контрольная МЦ', kind: 'material', genSingular: 'контрольной трубы', genPlural: 'контрольных труб', sizeTemplate: '{sizes} мм', deletedAt: null })).insertedId);
    const woodId = String((await dict.insertOne({ dict: 'passportMaterials', code: 'QA_MC_WOOD', name: 'Сосна контрольная МЦ', kind: 'material', genSingular: 'контрольной сосны', genPlural: 'контрольной сосны', deletedAt: null })).insertedId);
    const installId = String((await dict.insertOne({ dict: 'passportInstall', code: 'QA_MC_ANCHOR', name: 'Крепление анкерами', deletedAt: null })).insertedId);
    const photoId = String((await db().collection('photos').insertOne({ storageUrl: `/uploads/${fileName}`, mimeType: 'image/png', deletedAt: null })).insertedId);
    const supplier = (await http().post('/api/partners').set(auth()).send({ kind: 'our', name: 'ООО МЦ испытание' }).expect(201)).body.id;

    // Заявка без карточки материала. Складская позиция создаётся реальной приёмкой.
    const title = 'Профиль МЦ особого обозначения';
    const { id: requestId } = (await http().post('/api/supply/requests').set(auth()).send({ title, qty: 10, unit: 'м', supplierName: 'МЦ поставщик', priceHint: 1200 }).expect(201)).body;
    const invoiceId = (await http().post('/api/supply/invoices').set(auth()).send({ requestIds: [requestId] }).expect(201)).body.items[0].id;
    await http().patch(`/api/supply/invoices/${invoiceId}`).set(auth()).send({ no: 'МЦ-1', date: '2026-11-12', issue: true, payerCompanyId: supplier }).expect(200);
    await http().post(`/api/supply/invoices/${invoiceId}/pay`).set(auth()).expect(200);
    await http().post(`/api/supply/invoices/${invoiceId}/receive`).set(auth()).send({}).expect(200);
    const positions = (await http().get('/api/stock/items').set(auth()).query({ search: title }).expect(200)).body.items;
    expect(positions).toHaveLength(1);
    const position = positions[0];
    expect(position).toMatchObject({ name: title, quantity: 10 });
    const linkPath = `/api/materials/${position.id}/passport-spec`;
    await http().patch(linkPath).set(auth()).send({ materialId: pipeId, sizes: ['Ø89x3'], passportText: 'Паспортная формулировка МЦ', techText: 'Техническая формулировка МЦ' }).expect(200);
    await http().patch(linkPath).set(auth()).send({ sizes: ['Ø57x3'] }).expect(200);
    const linked = (await http().get(`/api/materials/${position.id}`).set(auth()).expect(200)).body;
    expect(linked.passportSpec).toMatchObject({ materialId: pipeId, sizes: ['∅57×3'], passportText: 'Паспортная формулировка МЦ', techText: 'Техническая формулировка МЦ' });

    const { id: productId } = (await http().post('/api/showcase').set(auth()).send({
      name: 'Указатель для прогона МЦ', sku: 'MC-QA-1', type: 'Благоустройство', group: 'Информационные стенды и указатели',
      dimensions: { length: 1000, width: 200, height: 1400, unit: 'мм' }, weightKg: 10, purpose: 'Информирование',
    }).expect(201)).body;
    const productPath = `/api/showcase/${productId}`;
    await http().put(`${productPath}/passport-defaults`).set(auth()).send({ passportCategory: 'BLG', installationTypeId: installId, serviceLifeYears: 10, joints: ['bolts'] }).expect(200);
    const { id: orderId } = (await http().post('/api/salesorders').set(auth()).send({ orderNo: 'МЦ-1', productionNo: 'МЦ-1', customer: 'МЦ покупатель' }).expect(201)).body;
    const { id: salesOrderLineId } = (await http().post('/api/incomes').set(auth()).send({ orderId, productId, title: 'Указатель для прогона МЦ', qty: 2 }).expect(201)).body;
    await http().post('/api/stock/batch').set(auth()).send({ type: 'out', salesOrderId: orderId, salesOrderLineId, lines: [{ materialId: position.id, qty: 4 }] }).expect(201);
    const suggestion = (await http().get('/api/stock/composition-suggest').set(auth()).query({ salesOrderLineId }).expect(200)).body;
    expect(suggestion.items).toMatchObject([{ materialId: position.id, net: 4, perProduct: 2, status: 'add' }]);
    const accepted = (await http().post('/api/stock/composition-suggest/accept').set(auth()).send({ salesOrderLineId }).expect(200)).body;
    expect(accepted.applied).toMatchObject([{ materialId: position.id, quantity: 2 }]);
    const fromComposition = (await http().get(`${productPath}/materials-spec/from-composition`).set(auth()).expect(200)).body;
    const oldSpec = { rows: [{ materialId: pipeId, sizes: ['∅57×3'], partIds: [] }], coatingIds: [] };
    expect(fromComposition).toMatchObject({ materialsSpec: oldSpec, unmatched: [], hinted: [] });
    expect(fromComposition.materialsText).toContain('контрольной трубы ∅57×3 мм');
    expect((await http().get(productPath).set(auth()).expect(200)).body.materialsSpec ?? null).toBeNull();
    await http().patch(productPath).set(auth()).send({ materialsSpec: fromComposition.materialsSpec }).expect(200);

    const manualMaterials = 'Ручное примечание о материалах МЦ.';
    const makeDraft = async () => (await http().post('/api/passports').set(auth()).send({
      productId, supplierOrgId: supplier, materials: manualMaterials, images: [{ kind: 'overview', photoId }],
    }).expect(201)).body;
    const oldDraft = await makeDraft();
    expect(oldDraft).toMatchObject({ materialsSpec: oldSpec, materials: manualMaterials });
    expect(oldDraft.textSnapshot.description).toContain('Труба контрольная МЦ');
    await http().post(`/api/passports/${oldDraft.id}/issue`).set(auth()).expect(200);
    const issued = await findPassport(oldDraft.id);
    expect(issued.textSnapshot.drawingLayout).toBe(2);
    const oldPdf = await pdf(issued.id);

    const draft = await makeDraft();
    const draftPdf = await pdf(draft.id);
    const manuallyEdited = await makeDraft();
    const section = manuallyEdited.textSnapshot.sections.find((item: { items?: unknown[] }) => item.items?.length);
    const item = section.items[0];
    const manualPoint = 'Ручной пункт МЦ — сохранить при изменении состава.';
    await http().patch(`/api/passports/${manuallyEdited.id}/snapshot-item`).set(auth())
      .send({ sectionKey: section.key, itemKey: item.key, text: manualPoint }).expect(200);

    const newSpec = { rows: [{ materialId: woodId, sizes: [], partIds: [] }], coatingIds: [] };
    await http().patch(productPath).set(auth()).send({ materialsSpec: newSpec }).expect(200);
    const current = await findPassport(draft.id);
    expect(current).toMatchObject({ materialsSpec: newSpec, materials: manualMaterials });
    expect(current.textSnapshot.description).toContain('Сосна контрольная МЦ');
    expect(current.textSnapshot.description).not.toContain('Труба контрольная МЦ');
    expect(withoutPdfMetadata(await pdf(current.id))).not.toBe(withoutPdfMetadata(draftPdf));
    const preserved = await findPassport(manuallyEdited.id);
    expect(preserved).toMatchObject({ materialsSpec: newSpec, materials: manualMaterials });
    expect(JSON.stringify(preserved.textSnapshot.sections)).toContain(manualPoint);
    const same = await findPassport(issued.id);
    expect(same).toMatchObject({ status: 'issued', materialsSpec: oldSpec, materials: manualMaterials, textSnapshot: issued.textSnapshot });
    expect(withoutPdfMetadata(await pdf(issued.id))).toBe(withoutPdfMetadata(oldPdf));
  });

  it('смена таблицы непосредственно в черновике пересобирает описание, ручной текст остаётся', async () => {
    const materialId = String((await db().collection('dict_values').insertOne({
      dict: 'passportMaterials', code: 'QA_MC_STEEL', name: 'Сталь контрольная МЦ', kind: 'material', deletedAt: null,
    })).insertedId);
    const materials = 'Ручное описание для черновика МЦ.';
    const draft = (await http().post('/api/passports').set(auth()).send({
      name: 'Черновик МЦ', passportCategory: 'BLG', materials,
    }).expect(201)).body;
    expect(draft.textSnapshot.description).toContain(materials);
    const materialsSpec = { rows: [{ materialId, sizes: [], partIds: [] }], coatingIds: [] };
    const updated = (await http().patch(`/api/passports/${draft.id}`).set(auth()).send({ materialsSpec }).expect(200)).body;
    expect(updated).toMatchObject({ materials, materialsSpec });
    expect(updated.textSnapshot.description).toContain('Сталь контрольная МЦ');
  });
});
