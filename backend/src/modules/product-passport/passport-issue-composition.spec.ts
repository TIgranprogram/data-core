import PDFDocument from 'pdfkit';
import { join } from 'path';
import { Types } from 'mongoose';
import { PassportIssue, type IssueHost } from './passport-issue';
import { layoutV2 } from './passport-pdf-v2-layout';
import { fontDir } from './passport-pdf';
import { A5 } from './passport-pdf-v2-common';
import type { PdfV2Input } from './passport-pdf-v2-types';

/** Реальный выпуск меняет сохраняемый документ, затем именно этот документ передаётся раскладке PDF. */
it.each(['tree', 'legacy', 'rich', 'different', 'issued'] as const)('C148 выпуск → сохранение → PDF: %s', async (mode) => {
  const state: Record<string, unknown> = {
    _id: new Types.ObjectId(), name: 'Изделие', status: mode === 'issued' ? 'issued' : 'draft',
    passportNumber: mode === 'issued' ? '19' : 'draft-x',
    modules: mode === 'tree' ? [{ name: 'Новая рама', qty: 2 }] : mode === 'rich' ? [{ name: 'Новая рама', qty: 2, dims: '2000×1000 мм', photoId: String(new Types.ObjectId()) }] : [{ name: 'Старый модуль', qty: 4 }],
    ...(mode !== 'legacy' ? { compositionSheet: [{ word: 'Модуль', label: 'Новая рама', qty: 2 }] } : {}),
  };
  const previousModules = JSON.stringify(state.modules);
  const write = jest.fn((set: Record<string, unknown>) => Object.assign(state, set));
  const chain = () => ({ session: () => chain(), lean: () => chain(), exec: async () => ({ ...state }) });
  const h: IssueHost = {
    model: {
      findOne: () => chain(),
      updateOne: (_q: unknown, u: { $set: Record<string, unknown> }) => ({ exec: async () => write(u.$set) }),
    } as never,
    connection: { startSession: async () => ({ withTransaction: async (run: () => Promise<void>) => run(), endSession: async () => {} }) } as never,
    findById: async () => ({ toObject: () => ({ ...state }) }) as never,
    readiness: async () => [], refresh: async () => {}, freezeImages: async () => {},
    allocate: async (set) => { set.passportNumber = '20'; }, assertFree: async () => {},
  };
  const issue = new PassportIssue(h);
  await issue.issue(String(state._id));
  expect(state.status).toBe('issued');
  expect(JSON.stringify(state.modules)).toBe(previousModules);
  if (mode === 'issued') expect(state).not.toHaveProperty('compositionPresentation');
  else expect(state.compositionPresentation).toBe(mode === 'tree' ? 'tree' : 'both');
  expect(write).toHaveBeenCalledTimes(mode === 'issued' ? 0 : 1);
  const input = { passport: state, org: { name: 'Проверка' }, text: { sections: [] }, images: {}, withStamp: false, mode: 'pages' } as unknown as PdfV2Input;
  const d = new PDFDocument({ autoFirstPage: false });
  d.registerFont('gost', join(fontDir(), 'gost-a.ttf'));
  d.registerFont('gost-i', join(fontDir(), 'gost-a-slanted.ttf'));
  const spy = jest.spyOn(d, 'text');
  for (const page of layoutV2(d, input, '#000')) {
    d.addPage({ size: [A5.w, A5.h], margin: 0 });
    for (const draw of page.draws) draw.draw(d, draw.y);
  }
  d.end();
  const printed = spy.mock.calls.map(([text]) => String(text)).join('\n');
  expect(printed.includes('Состав изделия: модули')).toBe(mode !== 'tree');
  if (mode === 'rich') expect(printed).toContain('2000×1000 мм');
  if (mode === 'tree') expect(printed).toContain('Новая рама');
  await issue.issue(String(state._id));
  expect(write).toHaveBeenCalledTimes(mode === 'issued' ? 0 : 1);
});
