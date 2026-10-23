import { applyDict, buildDescription, cleanText, missingFields, nextSeq, parseDecimal, parseRuDate, splitObject, warrantyCodeFor, type CounterColl } from './passport-rules';
import { imposition, shortFio, saleDateLine, docName } from './passport-pdf';
import { crc32, zipStore } from './zip';

describe('паспорта: номера (ПС.2)', () => {
  it('талон ГГГГМ-№, месяц без нуля — как в таблице', () => {
    expect(warrantyCodeFor(new Date(Date.UTC(2025, 7, 15)), 224)).toBe('20258-224');
    expect(warrantyCodeFor(new Date(Date.UTC(2026, 9, 13)), '549')).toBe('202610-549');
    expect(warrantyCodeFor(new Date(Date.UTC(2026, 0, 31)), 600)).toBe('20261-600');
  });

  /** Фейк коллекции с атомарным findOneAndUpdate (как Mongo: одна операция = одно чтение-запись). */
  const fakeCounters = () => {
    const docs = new Map<string, number>();
    const coll: CounterColl = {
      async findOneAndUpdate(filter: object, update: object[]) {
        const key = JSON.stringify(filter);
        await new Promise((r) => setTimeout(r, Math.random() * 5));
        const add = (update[0] as { $set: { seq: { $add: [{ $max: [unknown, number] }, number] } } }).$set.seq.$add;
        const floor = add[0].$max[1];
        const next = Math.max(docs.get(key) ?? 0, floor) + add[1];
        docs.set(key, next);
        return { seq: next };
      },
    };
    return coll;
  };

  it('следующий номер — после максимума уже лежащих (2577 → 2578), счётчик не откатывается', async () => {
    const c = fakeCounters();
    expect(await nextSeq(c, 'productCode', 2577)).toBe(2578);
    expect(await nextSeq(c, 'productCode', 2577)).toBe(2579);
    expect(await nextSeq(c, 'productCode', 3000)).toBe(3001); // ввели вручную больше — продолжаем после него
  });

  it('гонка двух создателей: разные номера', async () => {
    const c = fakeCounters();
    const got = await Promise.all(Array.from({ length: 20 }, () => nextSeq(c, 'passportNumber', 549)));
    expect(new Set(got).size).toBe(20);
    expect(Math.min(...got)).toBe(550);
  });

  it('pipeline-обновление счётчика — $max(текущий, floor)+1, upsert', async () => {
    const calls: unknown[] = [];
    const c: CounterColl = { async findOneAndUpdate(...a: unknown[]) { calls.push(a); return { value: { seq: 7 } }; } };
    expect(await nextSeq(c, 'x', 5)).toBe(7); // драйвер старого вида {value}
    expect(calls[0]).toEqual([{ entity: 'passport', prefix: 'x', year: 0 }, [{ $set: { seq: { $add: [{ $max: [{ $ifNull: ['$seq', 0] }, 5] }, 1] } } }], { upsert: true, returnDocument: 'after' }]);
  });
});

describe('паспорта: чистка текста при переносе (ПС.3)', () => {
  it('пробелы, \\" → ёлочки, знаки препинания', () => {
    expect(cleanText('  Стойки волейбольные, (комплект , без сетки)  ')).toBe('Стойки волейбольные (комплект, без сетки)');
    expect(cleanText('Качели \\"Гнездо\\"  большие')).toBe('Качели «Гнездо» большие');
    expect(cleanText('Стойка "Г" образная')).toBe('Стойка «Г» образная');
    expect(cleanText('условиях.Изделие устанавливается')).toBe('условиях. Изделие устанавливается');
    expect(cleanText('труба 40х40х2мм.,труба')).toBe('труба 40х40х2мм., труба');
  });
  it('опечатки — только по утверждённому словарю, целыми словами', () => {
    expect(applyDict('Скамяь парковая', { Скамяь: 'Скамья' })).toBe('Скамья парковая');
    expect(applyDict('Качли', {})).toBe('Качли');
    expect(applyDict('Качлимонтаж', { Качли: 'Качели' })).toBe('Качлимонтаж');
  });
  it('десятичная запятая и даты', () => {
    expect(parseDecimal('176,7')).toBe(176.7);
    expect(parseDecimal('')).toBeUndefined();
    expect(parseDecimal('12 кг')).toBeNaN();
    expect(parseRuDate('15.08.2025')?.toISOString()).toBe('2025-08-15T00:00:00.000Z');
    expect(parseRuDate('31.02.2025')).toBeUndefined();
  });
});

describe('паспорта: разнос «Объекта» (ПС.3)', () => {
  it.each([
    ['Ейское, п. Ближнеейск, ул. Садовая, 21', { kind: 'address', objectName: 'Ейское, п. Ближнеейск, ул. Садовая, 21' }],
    ['ИП Азизова', { kind: 'customer', customerName: 'ИП Азизова' }],
    ['Заказ № 24 ИП Сахаджи (Спортсет)', { kind: 'order', orderNo: '24', customerName: 'ИП Сахаджи', note: 'Спортсет' }],
    ['Заказ№31\nИП Ароян', { kind: 'order', orderNo: '31', customerName: 'ИП Ароян' }],
    ['Заказ 19 Академия благоустройства', { kind: 'order', orderNo: '19', objectName: 'Академия благоустройства' }],
    ['ИП Жданов ЗАКАЗ № 8', { kind: 'order', orderNo: '8', customerName: 'ИП Жданов' }],
    ['СОШ2', { kind: 'unknown', objectName: 'СОШ2' }],
    ['', { kind: 'empty' }],
  ])('%s', (raw, want) => {
    expect(splitObject(raw)).toEqual(want);
  });
});

describe('паспорта: описание и полнота (ПС.5)', () => {
  it('описание из частей', () => {
    expect(buildDescription({ name: 'Стойка баскетбольная.', materials: 'стальной профильной трубы 120х120х4 мм', installationMethod: 'Изделие устанавливается методом бетонирования', purpose: 'Предназначено для игры в баскетбол.' }))
      .toBe('Стойка баскетбольная (в дальнейшем именуемое «Изделие»), изготовленное из стальной профильной трубы 120х120х4 мм. Изделие устанавливается методом бетонирования. Предназначено для игры в баскетбол.');
    expect(buildDescription({ name: 'Урна' })).toBe('Урна (в дальнейшем именуемое «Изделие»).');
    expect(buildDescription({})).toBe('');
  });
  it('чего не хватает до выдачи', () => {
    expect(missingFields({})).toEqual(expect.arrayContaining(['Наименование', 'Дата', 'Поставщик', 'Габариты', 'Фото изделия']));
    const full = { name: 'Урна', category: 'МАФ', date: new Date(), supplierOrgId: 'x', height: 1, length: 1, width: 1, weight: 0.5, materials: 'сталь', installationMethod: 'бетон', purpose: 'мусор', description: 'd', objectName: 'парк', images: [{ kind: 'overview' }] };
    expect(missingFields(full)).toEqual([]);
  });
});

describe('паспорта: PDF и ZIP (ПС.6)', () => {
  it('спуск буклета 12 страниц — как в образце', () => {
    expect(imposition(12)).toEqual([[11, 0], [1, 10], [9, 2], [3, 8], [7, 4], [5, 6]]);
  });
  it('название в документе — полное наименование, иначе обычное', () => {
    expect(docName({ name: 'ООО «СИЮ»', fullName: 'Общество с ограниченной ответственностью «СпортИнЮг»' })).toBe('Общество с ограниченной ответственностью «СпортИнЮг»');
    expect(docName({ name: 'ООО «СИЮ»', fullName: '' })).toBe('ООО «СИЮ»');
    expect(docName(null)).toBe('');
  });
  it('ФИО и дата продажи (месяц прописью)', () => {
    expect(shortFio('Тен Александр Тимурович')).toBe('Тен А. Т.');
    expect(shortFio('Тен А.Т.')).toBe('Тен А.Т.');
    expect(saleDateLine(new Date('2026-10-22T00:00:00Z'))).toBe('«____» октября 2026 г.');
    expect(saleDateLine('2026-05-01')).toBe('«____» мая 2026 г.');
  });
  it('ZIP: подпись и CRC', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    const z = zipStore([{ name: 'а.pdf', data: Buffer.from('x') }]);
    expect(z.readUInt32LE(0)).toBe(0x04034b50);
    expect(z.readUInt32LE(z.length - 22)).toBe(0x06054b50);
  });
});
