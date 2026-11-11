import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { button } from '../ui/kit/index.js';

/** «15 000 ₽» — без копеек, если число целое. */
export const rubWas = (n) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(n)) + ' ₽';
const partyKey = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU');

/** id контрагента открытой формы; пусто — заказчик вписан текстом. */
export const partyPick = { id: '' };

export const LAST_KEYS = ['objectName', 'delivery', 'terms', 'prepaymentPercent', 'productionDays', 'deliveryDays'];

/** Контрагенты и недавние заказчики КП. Ошибка списка — пусто, имя можно вписать. */
export async function loadOfferParties() {
  const [list, offers] = await Promise.all([
    api('/counterparties', { query: { limit: 200, page: 1 } }).then((r) => r?.items || []).catch(() => []),
    api('/offers', { query: { limit: 40, sort: '-date' } }).then((r) => r?.items || []).catch(() => []),
  ]);
  const recent = [];
  const seen = new Set();
  for (const o of offers) {
    const name = String(o.customer || '').trim();
    if (!name) continue;
    const k = o.counterpartyId ? 'id:' + o.counterpartyId : partyKey(name);
    if (seen.has(k)) continue;
    seen.add(k);
    recent.push({ id: o.counterpartyId ? String(o.counterpartyId) : '', name });
  }
  return { parties: list, recent };
}

/** Сверху «Недавние», ниже контрагенты. extraNames — если справочник контрагентов недоступен. */
export function partyOptions(parties, recent, extraNames = []) {
  const byId = new Map((parties || []).map((p) => [String(p.id), p]));
  const labelOf = (p) => String(p.shortName || p.name || '').trim();
  const opts = [];
  const used = new Set();
  const push = (o) => { const k = partyKey(o.label); if (!k || used.has(k)) return; used.add(k); opts.push(o); };
  for (const r of recent || []) {
    const p = (r.id && byId.get(String(r.id))) || (parties || []).find((x) => partyKey(labelOf(x)) === partyKey(r.name));
    push({ value: p ? String(p.id) : (r.id || ''), label: p ? labelOf(p) : r.name, group: 'Недавние', sub: '' });
  }
  for (const p of [...(parties || [])].sort((a, b) => labelOf(a).localeCompare(labelOf(b), 'ru'))) {
    push({ value: String(p.id), label: labelOf(p), group: 'Контрагенты', sub: p.inn && !p.innIsStub ? 'ИНН ' + p.inn : '' });
  }
  if (!parties?.length) for (const name of extraNames || []) push({ value: '', label: String(name), group: 'Из заказов', sub: '' });
  return opts;
}

export async function fetchLastOffer({ customer, counterpartyId } = {}) {
  const query = {};
  if (counterpartyId) query.counterpartyId = counterpartyId;
  const name = String(customer || '').trim();
  if (name) query.customer = name;
  if (!query.counterpartyId && !query.customer) return null;
  const d = await api('/offers/last', { query }).catch(() => null);
  return d && d.offerId ? d : null;
}

/** Одна строка «как в прошлом КП» с «Подставить» / «Нет». Цены строк кладёт в ctx до ответа. */
export function lastOfferBanner(ctx) {
  const box = h('div', { class: 'hint wide', hidden: true });
  let seq = 0;
  let dismissed = '';
  const sig = () => `${ctx.partyId || ''}|${partyKey(ctx.customer?.() || '')}`;
  const hide = () => { box.hidden = true; box.replaceChildren(); };
  const ask = async () => {
    const my = ++seq;
    const customer = String(ctx.customer?.() || '').trim();
    const counterpartyId = ctx.partyId || '';
    if (customer.length < 2 && !counterpartyId) { hide(); ctx.setPrices?.(new Map()); ctx.repaint?.(); return; }
    const d = await fetchLastOffer({ customer, counterpartyId });
    if (my !== seq) return;
    ctx.setPrices?.(new Map((d?.prices || []).map((p) => [String(p.productId), Number(p.unitPrice)])));
    ctx.repaint?.();
    const useful = !!d && LAST_KEYS.some((k) => d[k] !== null && d[k] !== undefined && d[k] !== '');
    if (!useful || dismissed === sig() || (ctx.hasGap && !ctx.hasGap())) { hide(); return; }
    const when = d.date ? new Date(d.date).toLocaleDateString('ru-RU') : '';
    box.hidden = false;
    box.replaceChildren(
      h('span', null, `Как в прошлом КП № ${d.number} от ${when}: объект, условия, предоплата, сроки — подставить? `),
      button({ label: 'Подставить', kind: 'primary', size: 'S', onClick: () => { ctx.apply?.(d); dismissed = sig(); hide(); } }),
      button({ label: 'Нет', size: 'S', onClick: () => { dismissed = sig(); hide(); } }),
    );
  };
  return { el: box, ask, get value() { return ''; }, set value(_) { /* только показ */ } };
}

/** Поле заказчика формы: выбор контрагента пишет partyPick.id, набор ищет по имени. */
export function bindCustomer(fa, source, onChange) {
  const input = fa.input('customer');
  if (!input) return;
  let timer;
  let lastQ = '';
  const sync = () => {
    const hit = source.options.find((o) => partyKey(o.label) === partyKey(input.value) && o.value);
    partyPick.id = hit ? String(hit.value) : '';
    source.partyId = partyPick.id;
  };
  input.addEventListener('change', () => { sync(); onChange(); });
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      sync();
      onChange();
      const q = input.value.trim();
      if (q.length < 2 || q === lastQ) return;
      lastQ = q;
      const more = await api('/counterparties', { query: { search: q, limit: 30 } }).then((r) => r?.items || []).catch(() => []);
      const ids = new Set(source.parties.map((p) => String(p.id)));
      let add = false;
      for (const p of more) if (p?.id && !ids.has(String(p.id))) { source.parties.push(p); add = true; }
      if (!add) return;
      source.options = partyOptions(source.parties, source.recent, source.extra);
      input.dispatchEvent(new Event('input'));
    }, 350);
  });
}

/** Подставить пустые и авто-поля фирмы. Ручное не трогаем. Доставка — вместе с объектом. */
export function applyLastToForm(fa, d) {
  if (!fa || !d) return;
  const put = (k, v) => {
    if (v === null || v === undefined || v === '') return;
    if (typeof v === 'number' && v <= 0) return;
    if (fa.manual(k)) return;
    const cur = String(fa.get(k) ?? '').trim();
    const src = fa.field(k)?.querySelector?.(':scope > span')?.dataset.src || '';
    if (cur && src !== 'из шаблона фирмы' && src !== 'из настроек фирмы') return;
    fa.set(k, String(v), { auto: true, src: 'из прошлого КП' });
  };
  put('objectName', d.objectName);
  put('delivery', d.delivery);
  put('terms', d.terms);
  put('prepaymentPercent', d.prepaymentPercent);
  put('productionDays', d.productionDays);
  put('deliveryDays', d.deliveryDays);
  fa.open?.('objectName');
  fa.open?.('delivery');
}
