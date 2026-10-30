import { V2_CATS, V2_NUMS, categories, dictOpts, facets, ourCompanies } from './common.js';

/** Массовое изменение паспортов: общие поля. */
/** БЗ-9: поля массового изменения паспортов — общие для всех выбранных. */
export async function passportBulkFields() {
  const [els, mats, inst, ours, f, cats] = await Promise.all([dictOpts('passportElements'), dictOpts('passportMaterials'), dictOpts('passportInstall'), ourCompanies(), facets(), categories()]);
  const n = (v) => (v === '' ? null : v);
  return [
    { key: 'passportCategory', label: 'Категория паспорта', type: 'select', options: V2_CATS.filter((c) => c.value).map((c) => ({ value: c.value, label: c.label })),
      hint: 'Текст паспорта соберётся заново по новой категории — правки пунктов текста у этих паспортов сбросятся' },
    { key: 'category', label: 'Категория каталога', type: 'combo', options: cats },
    { key: 'installationTypeId', label: 'Способ установки', type: 'select', options: [{ value: '', label: '— не указан —' }, ...inst.map((o) => ({ value: o.value, label: o.label }))] },
    { key: 'elements', label: 'Функциональные элементы', type: 'tags', options: els, modes: true },
    { key: 'materialIds', label: 'Материалы', type: 'tags', options: mats, modes: true },
    { key: 'isKit', label: 'Поставляется разобранным', type: 'select', options: [{ value: 'no', label: 'Нет' }, { value: 'yes', label: 'Да' }], map: (v) => v === 'yes' },
    { key: 'serviceLifeYears', label: 'Срок службы, лет', type: 'number', map: n },
    { key: 'warrantyMonths', label: 'Гарантия, мес.', type: 'number', map: n },
    ...V2_NUMS.filter(([k]) => k !== 'serviceLifeYears').map(([k, l]) => ({ key: k, label: l, type: 'number', map: n })),
    { key: 'supplierOrgId', label: 'Поставщик (наша компания)', type: 'select', options: ours.map((o) => ({ value: o.id, label: o.name })) },
    { key: 'customerName', label: 'Заказчик', type: 'combo', options: f.customers.map((c) => c.value) },
    { key: 'orderNo', label: '№ договора', type: 'text' },
    { key: 'objectName', label: 'Адрес установки', type: 'text' },
    { key: 'installedBy', label: 'Монтаж выполнил', type: 'text' },
    { key: 'saleDate', label: 'Дата продажи', type: 'date', map: n },
    { key: 'installedAt', label: 'Дата монтажа', type: 'date', map: n },
  ];
}
