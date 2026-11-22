import { api, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, dateTime, money } from '../core/format.js';
import { newKey } from '../core/write-retry.js';
import { actions, button, fileButton, openCard, openPdfPreview, readonlyGroup, row, section, stack, toast, toastError } from '../ui/kit/index.js';
import { uploadPhoto } from '../ui/kit/photos.js';
import { DOCUMENT_KINDS, ISSUE_FIELDS, ISSUE_STATES, PAYMENT_EVENTS, SIGNATURE_STATES, copyLegal, legalDay, openIssues, optionalNumber, replaceByUid } from './sales-legal-state.js';

const opts = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));
const writable = () => session.canEditOrders && session.canMoney;
const parentPanel = () => [...document.querySelectorAll('aside[data-k="drawer"]:not([hidden])')].at(-1);
const pathOf = (kind, id) => `/${kind}/${id}`;

/** Вложенная правая форма сохраняет версию и UID до результата;409 требует перечитать, а не повторить поверх чужого. */
function legalForm(kind, record, ctx, { title, fields, initial = {}, change, reason }) {
  if (!writable() || !record.legal) return;
  const parent = parentPanel();
  if (!parent) return;
  const base = copyLegal(record.legal);
  const version = record.legalVersion ?? 0;
  const clientUid = newKey();
  let confirmed = false;
  let conflict = false;
  const panel = { title, newTitle: title, card: {}, form: {
    toBody: (values) => values,
    fields: () => fields, initial: () => initial, closeAfterCreate: true, saveLabel: 'Сохранить',
    async create(values) {
      if (conflict) throw new Error('Документ уже изменили. Закройте форму и обновите карточку перед новой правкой.');
      const legal = await change(copyLegal(base), values);
      try {
        await api(`${pathOf(kind, record.id)}/legal`, { method: 'PATCH', body: { version, clientUid, reason, legal } });
        confirmed = true;
        return { id: record.id };
      } catch (e) { if (e?.status === 409) conflict = true; throw e; }
    },
  } };
  return openCard(panel, { mode: 'create', parent }, {
    changed() {},
    close() { if (confirmed) { toast('Сведения сохранены'); void ctx.reload?.(); ctx.changed?.(); } },
  });
}

/** Адрес, юридическая готовность и условия редактируются отдельно от производственного этапа и денег. */
export function editLegal(kind, record, ctx) {
  const l = record.legal;
  if (!l) return;
  return legalForm(kind, record, ctx, {
    title: 'Сведения документа', reason: 'Уточнение сведений юридического документа',
    initial: { objectAddress: l.objectAddress || '', state: l.state, signature: l.signature?.state || 'unknown', signedDate: legalDay(l.signature?.signedDate), evidenceDocumentUid: l.signature?.evidenceDocumentUid || '', deliveryTerms: l.deliveryTerms || '', deadlineTerms: l.deadlineTerms || '' },
    fields: [
      { note: 'Пустое поле означает «неизвестно». Исходные файлы, даты и суммы этой формой не заменяются.' },
      { key: 'objectAddress', label: 'Адрес объекта', type: 'textarea', max: 1000, wide: true },
      { key: 'state', label: 'Проверка комплекта', type: 'select', options: [{ value: 'draft', label: 'Черновик — уточняем сведения' }, { value: 'verified', label: 'Комплект проверен менеджером' }] },
      { key: 'signature', label: 'Подписание', type: 'select', options: opts(SIGNATURE_STATES) },
      { key: 'signedDate', label: 'Дата подписания', type: 'date', hint: 'Не дата в шапке. Оставьте пустым, если неизвестна.' },
      { key: 'evidenceDocumentUid', label: 'Основание подписания', type: 'select', options: [{ value: '', label: 'Не указано' }, ...(l.documents || []).map((x) => ({ value: x.uid, label: [DOCUMENT_KINDS[x.kind], x.number].filter(Boolean).join(' ') }))] },
      { key: 'deliveryTerms', label: 'Доставка и монтаж', type: 'textarea', max: 4000, wide: true },
      { key: 'deadlineTerms', label: 'Условия срока', type: 'textarea', max: 4000, wide: true },
    ],
    change: (legal, v) => ({ ...legal, state: v.state, objectAddress: v.objectAddress?.trim() || null, signature: { ...legal.signature, state: v.signature, signedDate: v.signedDate || null, ...(v.evidenceDocumentUid ? { evidenceDocumentUid: v.evidenceDocumentUid } : {}) }, deliveryTerms: v.deliveryTerms || '', deadlineTerms: v.deadlineTerms || '' }),
  });
}

async function editIssue(kind, record, ctx, issue) {
  const staff = await api('/staff').then((r) => r.items || []).catch(() => []);
  const uid = issue?.uid || newKey();
  const target = issue?.field;
  const textTargets = ['objectAddress', 'deliveryTerms', 'deadlineTerms'];
  const actualField = textTargets.includes(target) ? { key: '_value', label: ISSUE_FIELDS[target], type: 'textarea', max: target === 'objectAddress' ? 1000 : 4000, wide: true }
    : target === 'signedDate' ? { key: '_value', label: 'Дата подписания', type: 'date' }
      : target === 'signature' ? { key: '_value', label: 'Подписание', type: 'select', options: opts(SIGNATURE_STATES) }
        : ['payment', 'paymentVerification'].includes(target) ? { key: '_value', label: 'Проверка поступлений', type: 'select', options: [{ value: 'unknown', label: 'Не проверено' }, { value: 'confirmed', label: 'Проверено; факты денег внесены отдельно' }] } : null;
  const actualValue = textTargets.includes(target) ? record.legal[target] || '' : target === 'signedDate' ? legalDay(record.legal.signature?.signedDate) : target === 'signature' ? record.legal.signature?.state : record.legal.paymentVerification;
  return legalForm(kind, record, ctx, {
    title: issue ? 'Уточнение менеджеру' : 'Добавить уточнение', reason: 'Изменение очереди заполнения документа',
    initial: { _value: actualValue, field: issue?.field || 'objectAddress', label: issue?.label || '', reason: issue?.reason || '', responsibleId: issue?.responsibleId || '', state: issue?.state || 'unknown', resolution: issue?.resolution || '' },
    fields: [
      ...(actualField ? [actualField] : []),
      { key: 'field', label: 'Что уточнить', type: 'select', required: true, options: opts(ISSUE_FIELDS) },
      { key: 'label', label: 'Название задачи', required: true, max: 200, wide: true },
      { key: 'reason', label: 'Что нужно выяснить', type: 'textarea', required: true, max: 1000, wide: true },
      { key: 'state', label: 'Состояние', type: 'select', options: opts(ISSUE_STATES) },
      ...(staff.length ? [{ key: 'responsibleId', label: 'Ответственный', type: 'select', options: [{ value: '', label: 'Не назначен' }, ...staff.map((p) => ({ value: p.id, label: p.name }))] }] : []),
      { key: 'resolution', label: 'Результат уточнения', type: 'textarea', max: 1000, wide: true, hint: 'Для завершения укажите результат и заполните соответствующее поле документа.' },
    ],
    change(legal, v) {
      const next = { ...issue, uid, field: v.field, label: v.label, reason: v.reason, state: v.state, resolution: v.resolution || '', ...(v.responsibleId ? { responsibleId: v.responsibleId } : {}) };
      if (actualField && v.field === target) {
        if (textTargets.includes(target)) legal[target] = v._value?.trim() || null;
        else if (target === 'signedDate') legal.signature = { ...legal.signature, signedDate: v._value || null };
        else if (target === 'signature') legal.signature = { ...legal.signature, state: v._value };
        else legal.paymentVerification = v._value;
      }
      return { ...legal, issues: replaceByUid(legal.issues || [], next) };
    },
  });
}

function editPaymentStage(kind, record, ctx, stage) {
  const uid = stage?.uid || newKey();
  return legalForm(kind, record, ctx, {
    title: 'Плановый этап оплаты', reason: 'Уточнение договорного плана оплаты',
    initial: { label: stage?.label || '', percent: stage?.percent ?? '', amount: stage?.amount ?? '', event: stage?.event || 'signed', offsetDays: stage?.offsetDays ?? '', dayType: stage?.dayType || 'calendar', dueDate: legalDay(stage?.dueDate), eventDate: legalDay(stage?.eventDate), evidenceDocumentUid: stage?.evidenceDocumentUid || '' },
    fields: [
      { note: 'Это условие договора, не запись о поступивших деньгах. Без подтверждённого события дату не рассчитываем.' },
      { key: 'label', label: 'Этап', required: true, max: 200, wide: true },
      { key: 'percent', label: 'Доля, %', type: 'number', min: 0, max: 100 },
      { key: 'amount', label: 'Плановая сумма', type: 'number', min: 0 },
      { key: 'event', label: 'Срок начинается от', type: 'select', options: opts(PAYMENT_EVENTS) },
      { key: 'offsetDays', label: 'Количество дней', type: 'number', min: 0, max: 3650 },
      { key: 'dayType', label: 'Дни', type: 'select', options: [{ value: 'calendar', label: 'Календарные' }, { value: 'business', label: 'Рабочие по календарю' }] },
      { key: 'eventDate', label: 'Подтверждённая дата события', type: 'date' },
      { key: 'evidenceDocumentUid', label: 'Документ-основание события', type: 'select', options: [{ value: '', label: 'Не указан' }, ...(record.legal.documents || []).map((x) => ({ value: x.uid, label: [DOCUMENT_KINDS[x.kind], x.number].filter(Boolean).join(' ') }))] },
      { key: 'dueDate', label: 'Согласованная дата срока', type: 'date', hint: 'Пусто, пока основание срока неизвестно.' },
    ],
    change(legal, v) {
      const next = { ...stage, uid, label: v.label, event: v.event, currency: legal.currency, dayType: v.dayType, dueDate: v.dueDate || null, eventDate: v.eventDate || null };
      if (v.evidenceDocumentUid) next.evidenceDocumentUid = v.evidenceDocumentUid; else delete next.evidenceDocumentUid;
      for (const key of ['percent', 'amount', 'offsetDays']) { const n = optionalNumber(v[key]); if (n === undefined) delete next[key]; else next[key] = n; }
      return { ...legal, paymentPlan: replaceByUid(legal.paymentPlan || [], next) };
    },
  });
}

export async function showOriginal(document) {
  if (!session.canMoney || !/^[a-f\d]{24}$/i.test(String(document.fileId || ''))) return;
  const photo = await api(`/photos/${document.fileId}`);
  const storage = String(photo.storageUrl || '');
  if (!/^\/uploads\/[a-z\d_./%+() -]+$/i.test(storage) || storage.includes('..')) throw new Error('У файла некорректная ссылка.');
  return openPdfPreview({ title: [DOCUMENT_KINDS[document.kind], document.number].filter(Boolean).join(' '), load: async () => {
    const res = await fetch(PREFIX + storage, { credentials: 'same-origin', redirect: 'error' });
    if (!res.ok) throw new Error('Не удалось открыть оригинал документа.');
    return { blob: await res.blob(), name: photo.originalFilename || 'document.pdf' };
  } });
}

function addDocument(kind, record, ctx) {
  const uid = newKey();
  let selected = null;
  let uploaded = null;
  let uploadUnknown = false;
  const selectedLabel = h('p', { class: 'hint' }, 'Выберите PDF оригинала.');
  const picker = { el: stack(fileButton({ label: 'Выбрать PDF', accept: 'application/pdf,.pdf', onFile: (f) => { selected = f; uploaded = null; selectedLabel.textContent = f.name; } }), selectedLabel), get value() { return selected?.name || ''; } };
  return legalForm(kind, record, ctx, {
    title: 'Прикрепить документ', reason: 'Добавление оригинала юридического документа',
    initial: { kind: kind === 'offers' ? 'offer' : 'customer_invoice', revision: '1' },
    fields: [
      { key: 'kind', label: 'Вид документа', type: 'select', options: opts(DOCUMENT_KINDS) },
      { key: 'number', label: 'Номер из документа', max: 100 },
      { key: 'date', label: 'Дата из документа', type: 'date' },
      { key: 'revision', label: 'Редакция', required: true, max: 50 },
      { key: 'gross', label: 'Сумма по документу', type: 'number', min: 0 },
      { key: 'vatRate', label: 'Ставка НДС, %', type: 'number', min: 0, max: 100 },
      { key: 'vatAmount', label: 'Сумма НДС', type: 'number', min: 0 },
      { key: 'supersedesUid', label: 'Взамен редакции', type: 'select', options: [{ value: '', label: 'Первый документ / отдельный счёт' }, ...(record.legal.documents || []).map((x) => ({ value: x.uid, label: [DOCUMENT_KINDS[x.kind], x.number, 'ред.' + x.revision].filter(Boolean).join(' ') }))] },
      { key: 'reason', label: 'Причина новой редакции', type: 'textarea', max: 1000, wide: true },
      { key: '_file', label: 'Оригинальный файл', type: 'widget', wide: true, widget: () => picker },
    ],
    async change(legal, v) {
      if (!selected || !/\.pdf$/i.test(selected.name)) throw new Error('Выберите PDF оригинала.');
      if (uploadUnknown) throw new Error('Результат загрузки файла неизвестен. Не загружайте его повторно: сначала проверьте сохранение файла.');
      if (!uploaded) {
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await selected.arrayBuffer()))].map((n) => n.toString(16).padStart(2, '0')).join('');
        // Результат загрузки остаётся в форме: ошибка legal-CAS не вызывает повторный upload.
        let photo;
        uploadUnknown = true;
        try { photo = await uploadPhoto(selected); } catch (e) { throw new Error('Не удалось подтвердить результат загрузки. Повтор отключён, чтобы не создать второй файл.', { cause: e }); }
        uploadUnknown = false;
        uploaded = { fileId: photo.id, sourceSha256: hash };
      }
      const doc = { uid, kind: v.kind, revision: v.revision, ...uploaded, currency: legal.currency };
      for (const key of ['number', 'date', 'supersedesUid', 'reason']) if (v[key]) doc[key] = v[key];
      for (const key of ['gross', 'vatRate', 'vatAmount']) { const n = optionalNumber(v[key]); if (n !== undefined) doc[key] = n; }
      return { ...legal, documents: [...legal.documents, doc] };
    },
  });
}

/** Общие блоки договоров и КП. Сначала таблица сущности; эти блоки ставит вызывающая карточка после неё. */
export function legalBlocks(kind, record, ctx) {
  const legal = record.legal;
  if (!legal) return null;
  const can = writable() && !record.activeArchiveVersion;
  const issues = legal.issues || [];
  const unknown = openIssues(legal);
  const issueRows = issues.map((x) => row({ title: x.label, meta: [ISSUE_STATES[x.state] || x.state, x.reason, x.resolution].filter(Boolean).join(' · '), tone: ['unknown', 'conflict'].includes(x.state) ? 'warn' : 'neutral', action: can ? button({ label: 'Заполнить', size: 'S', onClick: () => editIssue(kind, record, ctx, x) }) : null }));
  return stack(
    section({ title: unknown.length ? 'Требует заполнения' : 'Уточнения менеджеру', count: unknown.length, open: unknown.length > 0, body: stack(...issueRows, can ? actions(button({ label: 'Добавить уточнение', size: 'S', onClick: () => editIssue(kind, record, ctx) })) : null) }),
    section({ title: 'Документы и оригиналы', count: legal.documents?.length || 0, body: stack(...(legal.documents || []).map((x) => row({ title: [DOCUMENT_KINDS[x.kind] || 'Документ', x.number, x.date ? 'от ' + date(x.date) : ''].filter(Boolean).join(' '), meta: ['Редакция ' + x.revision, x.at ? 'Добавлено ' + dateTime(x.at) : '', x.reason].filter(Boolean).join(' · '), action: session.canMoney && x.fileId ? button({ label: 'Открыть оригинал', size: 'S', onClick: () => showOriginal(x).catch(toastError) }) : null })), can ? actions(button({ label: 'Прикрепить документ', size: 'S', onClick: () => addDocument(kind, record, ctx) })) : null) }),
    section({ title: 'Условия и реквизиты', body: stack(readonlyGroup({ rows: [
      ['Состояние комплекта', legal.state === 'verified' ? 'Проверен менеджером' : 'Черновик'],
      ['Дата исходника', date(legal.sourceDate)], ['Дата ввода', dateTime(record.createdAt)],
      ['Объект', legal.objectAddress || 'Нужно уточнить'], ['Подписание', SIGNATURE_STATES[legal.signature?.state] || 'Не проверено'],
      ['Дата подписания', legal.signature?.signedDate ? date(legal.signature.signedDate) : 'Неизвестна'],
      ['Поступления проверены', legal.paymentVerification === 'confirmed' ? 'Да — факты отдельно в деньгах' : 'Нужно уточнить'],
      ['Наша компания по документу', legal.companySnapshot?.name], ['Покупатель по документу', legal.counterpartySnapshot?.name],
      ['ИНН покупателя', legal.counterpartySnapshot?.inn], ['Доставка и монтаж', legal.deliveryTerms], ['Условия срока', legal.deadlineTerms],
      ...(session.canMoney ? [['Сумма исходника', legal.gross == null ? '' : money(legal.gross)], [kind === 'offers' ? 'НДС исходного КП' : 'НДС договора', legal.vatAmount == null ? '' : money(legal.vatAmount)]] : []),
    ] }), can ? actions(button({ label: 'Уточнить сведения', size: 'S', onClick: () => editLegal(kind, record, ctx) })) : null) }),
    session.canMoney ? section({ title: 'План оплаты', count: legal.paymentPlan?.length || 0, body: stack(h('p', { class: 'hint' }, 'План не подтверждает поступление денег. Без известного события срок не вычисляется.'), ...(legal.paymentPlan || []).map((x) => row({ title: x.label, meta: [x.amount == null ? '' : money(x.amount), x.percent == null ? '' : x.percent + '%', PAYMENT_EVENTS[x.event], x.offsetDays == null ? '' : `${x.offsetDays} ${x.dayType === 'business' ? 'рабочих' : 'календарных'} дней`, x.dueDate ? 'Срок ' + date(x.dueDate) : 'Дата срока не определена'].filter(Boolean).join(' · '), action: can ? button({ label: 'Уточнить', size: 'S', onClick: () => editPaymentStage(kind, record, ctx, x) }) : null })), can ? actions(button({ label: 'Добавить этап', size: 'S', onClick: () => editPaymentStage(kind, record, ctx) })) : null) }) : null,
  );
}
