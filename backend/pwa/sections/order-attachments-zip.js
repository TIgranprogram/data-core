import { api, apiFile, PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { modal } from '../ui/kit/dialog.js';
import { empty } from '../ui/kit/empty.js';
import { tagPick } from '../ui/kit/pick.js';
import { toast, toastError } from '../ui/kit/toast.js';
import { sideNote } from '../ui/kit/side-form.js';

/**
 * «Скачать вложения заказа» (ВЛ-1, FE-2): окно с выбором видов вложений, строкой «N файлов, X МБ» и скачиванием ZIP.
 * Сервер считает по договору: summary → zip-ticket → переход по url. Если в заказе несколько договоров — по архиву на договор.
 */
const sizeText = (n) => (!n ? '0 КБ' : n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} ГБ` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);
const filesWord = (n) => { const m = n % 100, d = n % 10; return m > 10 && m < 15 ? 'файлов' : d === 1 ? 'файл' : d > 1 && d < 5 ? 'файла' : 'файлов'; };

/** Понятный отказ сервера по-русски. */
export function zipErrorText(e) {
  const s = e?.status;
  if (s === 413) return 'Архив слишком большой. Скачайте вложения по одному виду или по отдельному изделию.';
  if (s === 429) return 'Сейчас собирается другой архив. Повторите через минуту.';
  if (s === 403) return 'Нет права скачивать вложения заказа. Обратитесь к администратору.';
  if (s === 0) return 'Нет связи с сервером. Проверьте интернет и повторите.';
  const msg = String(e?.message || '');
  return /[а-яё]/i.test(msg) ? msg : 'Архив не собрался. Повторите позже.';
}

const q = (ids) => encodeURIComponent(ids.join(','));

async function summaryOf(contracts, ids) {
  const rs = await Promise.all(contracts.map((c) => api(`/salesorders/${c.id}/attachments/summary?types=${q(ids)}`)));
  return { files: rs.reduce((s, r) => s + (r.files || 0), 0), bytes: rs.reduce((s, r) => s + (r.bytes || 0), 0), tooBig: rs.some((r) => r.tooBig), per: rs };
}

function openUrl(url) {
  const a = h('a', { href: PREFIX + url, download: '' });
  document.body.append(a); a.click(); a.remove();
}

/** order — карточка заказа (orders[] с id). */
export async function orderAttachmentsZip(order) {
  const contracts = (order.orders || []).filter((o) => o.id);
  if (!contracts.length) { toast('В заказе нет договоров.'); return; }
  let types;
  try {
    const tr = await api('/dicts/attachmentTypes');
    types = (tr.items || tr).filter((t) => t && t.name).map((t) => ({ id: String(t.id || t._id), name: t.name, order: Number(t.order) || 0 }))
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ru'));
  } catch (e) { toast(zipErrorText(e)); return; }

  const info = sideNote('Отметьте виды вложений.');
  const tp = tagPick({ options: types.map((t) => ({ value: t.id, label: t.name })), value: [], label: 'Виды вложений' });
  const chosen = () => JSON.parse(tp.value);
  let seq = 0, last = null;
  const refresh = async () => {
    const ids = chosen(); const my = ++seq; last = null;
    if (!ids.length) { info.textContent = 'Отметьте виды вложений.'; return; }
    info.textContent = 'Считаем файлы…';
    try {
      const s = await summaryOf(contracts, ids);
      if (my !== seq) return;
      last = s;
      info.textContent = !s.files ? 'Файлов выбранных видов в заказе нет.'
        : `${s.files} ${filesWord(s.files)}, ${sizeText(s.bytes)}` + (s.tooBig ? ' — архив слишком большой, выберите меньше видов.' : '') + (contracts.length > 1 ? ` (архивов: ${s.per.filter((r) => r.files).length}, по одному на договор)` : '');
    } catch (e) { if (my === seq) info.textContent = zipErrorText(e); }
  };
  tp.el.addEventListener('change', refresh);

  const body = types.length
    ? h('div', null, tp.el, info)
    : empty({ title: 'Виды вложений не заведены', hint: 'Администратор добавляет их в справочнике «Виды вложений».' });

  await modal({
    title: `Вложения заказа № ${order.productionNo || '—'}`,
    body, okText: 'Скачать', cancelText: 'Закрыть',
    onOk: async () => {
      const ids = chosen();
      if (!ids.length) throw new Error('Отметьте хотя бы один вид вложений.');
      if (last && !last.files) throw new Error('Файлов выбранных видов в заказе нет.');
      try {
        const targets = last ? contracts.filter((c, i) => last.per[i]?.files) : contracts;
        for (const c of targets) {
          const t = await api(`/salesorders/${c.id}/attachments/zip-ticket?types=${q(ids)}`, { method: 'POST' });
          openUrl(t.url);
        }
      } catch (e) { throw new Error(zipErrorText(e)); }
      return true;
    },
  });
}

/** Пункт «Скачать вложения заказа» в шапке карточки заказа (salesorders.actions). */
export const orderZipAction = { label: 'Скачать вложения заказа', more: true, title: 'Файлы изделий заказа (чертежи, паспорта…) одним архивом', run: (row) => orderAttachmentsZip(row) };
/** «PDF заказа» (пользователь 2026-11-06): весь заказ с перечнем позиций для печати А4 одной кнопкой. Сервер: GET /production-orders/:key/pdf. */
export const orderPdfAction = { label: 'PDF заказа', title: 'Весь заказ с перечнем позиций — для печати А4', run: async (row) => {
  try { const name = await apiFile(`/production-orders/${encodeURIComponent(row.key || row.productionNo || row.id)}/pdf`, { fallback: `Заказ_${row.productionNo || row.orderNo || ''}.pdf` }); toast(`Скачан: ${name}`); } catch (e) { toastError(e, 'скачать PDF заказа'); }
} };
