import { compositionPresentation } from './passport-composition-presentation';

const tree = [{ kind: 'module', word: 'Модуль', label: 'Рама', qty: 2 }, { kind: 'module', word: 'Модуль', label: 'Секция', qty: 3 }];
const plain = [{ name: ' Секция ', qty: 3 }, { name: 'Рама', qty: 2 }];
it('C152: подавляется только точный полный multiset plain названий и количеств', () => {
  const p = { status: 'draft', compositionSheet: tree, modules: plain };
  expect(compositionPresentation(p)).toBe('tree');
  expect(compositionPresentation({ ...p, modules: plain.slice(1) })).toBe('both');
  expect(compositionPresentation({ ...p, modules: [...plain, plain[0]] })).toBe('both');
  expect(compositionPresentation({ ...p, modules: [{ ...plain[0], qty: 4 }, plain[1]] })).toBe('both');
  expect(compositionPresentation({ ...p, modules: [{ ...plain[0], name: 'Секция похожая' }, plain[1]] })).toBe('both');
  for (const extra of [{ dims: '2000×1000' }, { photoId: 'a'.repeat(24) }, { caption: 'Не терять' }]) {
    expect(compositionPresentation({ ...p, modules: [{ ...plain[0], ...extra }, plain[1]] })).toBe('both');
  }
  expect(compositionPresentation({ ...p, status: 'issued' })).toBe('both');
  expect(compositionPresentation({ ...p, status: 'issued', compositionPresentation: 'tree' })).toBe('tree');
});
