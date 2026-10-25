import { afterPrintLines, fullDateLine } from './passport-pdf';
import { missingFields, missingKeyed } from './passport-rules';

/** ПП: «заполняется после печати» — в PDF значение или линия; выпуск не блокируют. */
describe('поля «после печати»', () => {
  it('пусто — линии для ручки (дата продажи — месяц и год по дате паспорта)', () => {
    const l = afterPrintLines({ date: '2026-10-23' });
    expect(l.map((x) => x.label)).toEqual(['Дата продажи:', 'Покупатель:', '№ заказа:', 'Адрес установки:', 'Монтаж выполнил:', 'Дата монтажа:']);
    expect(l.every((x) => x.blank)).toBe(true);
    expect(l[0].text).toBe('«____» октября 2026 г.');
    expect(l[1].text).toMatch(/^_+$/);
  });
  it('заполнено — значение', () => {
    const l = afterPrintLines({ date: '2026-10-23', saleDate: '2026-11-05', customerName: ' ГБУ  Жилищник ', orderNo: '125', objectName: 'ул. Ленина, 1', installedBy: 'Иванов И. И.', installedAt: '2026-11-10' });
    expect(l.map((x) => x.text)).toEqual(['«05» ноября 2026 г.', 'ГБУ Жилищник', '125', 'ул. Ленина, 1', 'Иванов И. И.', '«10» ноября 2026 г.']);
    expect(l.some((x) => x.blank)).toBe(false);
  });
  it('fullDateLine — число с нулём', () => expect(fullDateLine('2026-01-02')).toBe('«02» января 2026 г.'));
  it('заказчик / объект и прочее «после печати» не входят в «не хватает»', () => {
    const full = { name: 'Урна', category: 'Благоустройство', date: new Date(), supplierOrgId: 'x', height: 1, length: 1, width: 1, weight: 1, materials: 'сталь', installationMethod: 'анкеры', purpose: 'мусор', description: 'd', images: [{ kind: 'overview' }] };
    expect(missingFields(full as never)).toEqual([]);
    const k = missingKeyed({ ...full, passportCategory: 'BLG', installationTypeId: 'i', serviceLifeYears: 5 } as never, { requiredFields: 'serviceLifeYears' });
    expect(k.map((x) => x.key)).not.toEqual(expect.arrayContaining(['customerName', 'objectName', 'orderNo', 'saleDate', 'installedBy', 'installedAt', 'note']));
  });
});
