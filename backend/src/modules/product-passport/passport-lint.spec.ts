import { lintMode, lintPassportText, type LintText } from './passport-lint';
import * as fs from 'fs';
import * as path from 'path';

const sec = (key: string, title: string, items: Array<[string | null, string, boolean?]>) => ({ key, number: '1', title, items: items.map(([number, text, bullet], i) => ({ key: `p${i}`, number, text, bullet: !!bullet })) });
const codes = (t: LintText, card = {}) => lintPassportText(t, card).map((f) => f.code);
const has = (t: LintText, code: string, card = {}) => codes(t, card).includes(code);

describe('passport-lint (C137 Э1): плохо / хорошо', () => {
  it('способ установки: бетон и анкеры — ошибка; одинаково — нет', () => {
    const bad: LintText = { description: 'Крепится бетонированием опор.', sections: [sec('mounting', 'Монтаж', [['4.1', 'Закрепить на анкерах.']])] };
    expect(has(bad, 'install-mismatch')).toBe(true);
    expect(has({ description: 'Крепится бетонированием.', sections: [sec('mounting', 'Монтаж', [['4.1', 'Выполнить бетонирование опор.']])] }, 'install-mismatch')).toBe(false);
    expect(has({ description: 'x', sections: [sec('x', 'Т', [['1', 'ok']])] }, 'install-mismatch', { captions: ['Установка на анкеры'] })).toBe(false);
    expect(has(bad, 'install-mismatch', { captions: ['Бетонирование'] })).toBe(true);
  });
  it('стоп-слова', () => {
    for (const s of ['при их наличии', 'при наличии', 'Если опоры бетонируют', 'размер — — мм', 'Стелла у входа', 'размер 100 х 200']) {
      expect(has({ sections: [sec('a', 'А', [['1.1', `Текст ${s}.`]])] }, 'stop-word')).toBe(true);
    }
    expect(has({ sections: [sec('a', 'А', [['1.1', 'Стеллажи и размер 100 × 200.']])] }, 'stop-word')).toBe(false);
  });
  it('слово без признака в карточке', () => {
    const t = (txt: string, traits: string[]): LintText => ({ traits, description: 'масло', sections: [sec('a', 'А', [['1.1', txt]])] });
    expect(has(t('Проверить сварные швы.', ['wood']), 'word-unsupported')).toBe(true);
    expect(has(t('Проверить сварные швы.', ['welds']), 'word-unsupported')).toBe(false);
    expect(has(t('Нет коррозии.', ['wood']), 'word-unsupported')).toBe(true);
    expect(has(t('Нет коррозии.', ['metal']), 'word-unsupported')).toBe(false);
    expect(has(t('Лакокрасочное покрытие.', []), 'word-unsupported')).toBe(true);
    expect(has(t('Лакокрасочное покрытие.', []), 'word-unsupported', { coatingText: 'Эмаль' })).toBe(false);
    expect(has(t('Анкерные болты.', ['concrete']), 'word-unsupported')).toBe(true);
    expect(has(t('Закладные части.', ['anchors']), 'word-unsupported')).toBe(false);
    expect(has(t('Закладные части.', ['concrete']), 'word-unsupported')).toBe(false);
  });
  it('чек-лист: пустые графы и чужой узел', () => {
    const m = (rows: Array<{ what: string; where: string; measure: string; tolerance: string }>): LintText => ({ maintenance: [{ period: 'ежемесячно', rows }] });
    expect(lintPassportText(m([{ what: 'A', where: 'Стенд', measure: '', tolerance: '' }])).find((f) => f.code === 'checklist-empty')?.severity).toBe('error');
    expect(lintPassportText(m([{ what: 'A', where: 'Стенд', measure: 'Сделать', tolerance: '' }])).find((f) => f.code === 'checklist-empty')?.severity).toBe('warn');
    expect(has(m([{ what: 'A', where: 'Стенд', measure: 'М', tolerance: 'Д' }]), 'checklist-empty')).toBe(false);
    expect(has(m([{ what: 'A', where: 'Указатель', measure: 'М', tolerance: 'Д' }]), 'checklist-foreign', { elementNames: ['Информационный стенд'] })).toBe(true);
    expect(has(m([{ what: 'A', where: 'Информационный стенд', measure: 'М', tolerance: 'Д' }]), 'checklist-foreign', { elementNames: ['Информационный стенд'] })).toBe(false);
  });
  it('ссылки', () => {
    const t = (txt: string): LintText => ({ maintenance: [{ period: 'ежемесячно', rows: [] }], install: { requiredImages: ['foundation'] }, sections: [sec('a', 'А', [['1.1', txt]])] });
    expect(has(t('см. {tab:nothing}'), 'ref-missing')).toBe(true);
    expect(has(t('см. {tab:service} и {tab:to:ежемесячно}'), 'ref-missing')).toBe(false);
    expect(has(t('см. {tab:to:ежегодно}'), 'ref-missing')).toBe(true);
    expect(has(t('см. {fig:holes}'), 'ref-missing', { imageKinds: ['overview'] })).toBe(true);
    expect(has(t('см. {fig:foundation}'), 'ref-missing', { imageKinds: ['overview'] })).toBe(false);
  });
  it('имя одинаково', () => {
    const t = (a: string, b: string): LintText => ({ sections: [sec('general', 'Общие', [['3.1', `Паспорт на элемент: ${a}.`]]), sec('acceptance', 'Приёмка', [['14.1', `Наименование изделия: ${b}.`]])] });
    expect(has(t('Стенд', 'Стенд'), 'name-mismatch', { name: 'Стенд' })).toBe(false);
    expect(has(t('Стенд', 'Указатель'), 'name-mismatch', { name: 'Стенд' })).toBe(true);
    expect(has(t('Стенд', 'Стенд'), 'name-mismatch', { name: 'Стенд', ticketName: 'Стела' })).toBe(true);
  });
  it('дубли и абзац без номера', () => {
    const long = 'Одинаковый длинный абзац текста паспорта.';
    const dup: LintText = { sections: [sec('a', 'Уход', [['1.1', long]]), sec('b', 'Уход', [['2.1', long]])] };
    expect(codes(dup)).toEqual(expect.arrayContaining(['dup-paragraph', 'dup-heading']));
    expect(has({ sections: [sec('a', 'А', [[null, 'Абзац без номера и не пункт списка.']])] }, 'no-number')).toBe(true);
    expect(has({ sections: [sec('a', 'А', [[null, '— пункт списка', true]])] }, 'no-number')).toBe(false);
  });
  it('режим: по умолчанию warn', () => {
    expect(lintMode({})).toBe('warn');
    expect(lintMode({ PASSPORT_LINT_MODE: 'error' })).toBe('error');
    expect(lintMode({ PASSPORT_LINT_MODE: 'x' })).toBe('warn');
  });
});

describe('passport-lint: паспорт 601 (C134, снимок до исправлений)', () => {
  const file = path.resolve(__dirname, '../../../../docs/crew/C134-passport-book-editor/FIX-601-before.json');
  const f = fs.existsSync(file) ? it : it.skip;
  f('даёт ожидаемые находки', () => {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const found = lintPassportText(j.textSnapshot, { name: j.name, joints: j.joints, coatingText: 'Защитное масло', elementNames: ['Информационный стенд', 'Указатель'] });
    const by = (c: string) => found.filter((x) => x.code === c);
    expect(by('stop-word').map((x) => x.text).join()).toMatch(/при их наличии/);
    expect(by('stop-word').map((x) => x.text).join()).toMatch(/если опоры/);
    expect(by('checklist-empty').filter((x) => x.severity === 'error')).toHaveLength(10);
    expect(by('word-unsupported').some((x) => /лакокрасочн/.test(x.text))).toBe(true);
    expect(by('word-unsupported').some((x) => /коррози/.test(x.text))).toBe(true);
    expect(by('name-mismatch')).toHaveLength(0);
    expect(by('install-mismatch')).toHaveLength(0);
    expect(by('ref-missing')).toHaveLength(0);
  });
});
