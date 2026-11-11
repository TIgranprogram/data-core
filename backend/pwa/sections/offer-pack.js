/**
 * C071: «КП от других фирм» — правая панель (?of=offerpack&open=<id>), блок «Пакет», ZIP PDF.
 * Только фабрики kit и базовые классы (design-lint L2/L3).
 */
import { api, apiBlob } from '../core/api.js';
import { h } from '../core/dom.js';
import { money } from '../core/format.js';
import { go, patch } from '../core/router.js';
import { button, badge, stack, section, tagPick, textInput, row } from '../ui/kit/index.js';
import { toast, toastError } from '../ui/kit/toast.js';
import { confirmDlg } from '../ui/kit/dialog.js';

const PREF_KEY = 'dc-offer-pack-prefs';
const STATUS = {
  draft: { label: 'Черновик', tone: 'dim' },
  sent: { label: 'Отправлено', tone: 'info' },
  accepted: { label: 'Принято', tone: 'primary' },
  paid: { label: 'Оплачено', tone: 'ok' },
  rejected: { label: 'Отклонено', tone: 'danger' },
  cancelled: { label: 'Отменено', tone: 'dim' },
};

const readPrefs = () => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch { return {}; } };
const writePrefs = (o) => { try { localStorage.setItem(PREF_KEY, JSON.stringify(o)); } catch { /* приватный режим */ } };
const marked = (price, pct) => Math.round((Number(price) * (100 + Number(pct || 0))) / 100);

/** zip «stored» без сжатия — как в xlsx-write.js. */
function zipStored(files) {
  const enc = new TextEncoder();
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const parts = []; const central = []; let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name); const crc = crc32(f.data); const size = f.data.length;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint32(14, crc, true); local.setUint32(18, size, true); local.setUint32(22, size, true); local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, size, true); cd.setUint32(24, size, true); cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

async function downloadPackZip(items, packLabel) {
  const files = [];
  for (const o of items) {
    const { blob, name } = await apiBlob(`/offers/${o.id}/pdf`, { fallback: `КП-${o.number || o.id}.pdf` });
    const buf = new Uint8Array(await blob.arrayBuffer());
    const safe = String(name || `КП-${o.number}.pdf`).replace(/[\\/:*?"<>|]+/g, '_');
    const firm = String(o.companyName || '').replace(/[\\/:*?"<>|]+/g, '_');
    files.push({ name: firm ? `${firm}_${safe}` : safe, data: buf });
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(zipStored(files));
  a.download = `КП-пакет-${packLabel || 'архив'}.zip`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

/** Открыть правую панель «КП от других фирм» для исходного КП. */
export function openOfferPack(offerId) {
  patch({ of: 'offerpack', open: String(offerId), new: undefined });
}

function blankNote(names) {
  return stack(
    h('p', { class: 'muted small' },
      `Нет бланка КП: ${names.join(', ')}. Загрузите бланк в Контрагенты → Наши компании`),
    button({ label: 'Загрузить бланк', size: 'S', kind: 'secondary', onClick: () => go('partners') }),
  );
}

/** Форма панели: фирмы + наценка (строки один раз; при вводе — только текст суммы). */
async function buildPackForm(row) {
  const r = row;
  const all = await api('/offers/companies').then((x) => x?.items || []).catch(() => []);
  const others = all.filter((c) => String(c.id) !== String(r.companyId));
  const withBlank = others.filter((c) => c.hasBlank);
  const noBlank = others.filter((c) => !c.hasBlank);
  const prefs = readPrefs();
  const prefMap = new Map((prefs.companies || []).map((p) => [String(p.id), Number(p.markup) || 0]));
  const prefIds = (prefs.companies || []).map((p) => String(p.id)).filter((id) => withBlank.some((c) => c.id === id));

  const markups = new Map(withBlank.map((c) => [c.id, prefMap.has(c.id) ? prefMap.get(c.id) : 0]));
  const rowsById = new Map(); // id → { el, sumEl, ti }
  let selected = prefIds.slice();
  let setSave = () => {};

  const summary = h('p', { class: 'hint' }, '');
  const sums = stack();
  const blankBox = stack();

  const syncBlank = () => {
    blankBox.replaceChildren(noBlank.length ? blankNote(noBlank.map((c) => c.name)) : null);
  };

  const syncSave = () => {
    const n = selected.length;
    summary.textContent = n ? `Получится ${n + 1} КП` : 'Отметьте фирмы — получится пакет с исходным КП.';
    setSave(n > 0 && withBlank.length > 0, n ? `Создать ${n} КП` : 'Создать КП');
  };

  const updateSumText = (id) => {
    const rowRef = rowsById.get(id);
    if (!rowRef) return;
    const pct = Number(markups.get(id) ?? 0);
    rowRef.sumEl.textContent = `+${pct} % · ${money(marked(Number(r.total) || 0, pct))}`;
  };

  /** Строки фирм — только при смене выбора (не при каждой цифре). */
  const rebuildRows = (ids) => {
    selected = ids;
    const keep = new Set(ids);
    for (const id of [...rowsById.keys()]) if (!keep.has(id)) rowsById.delete(id);
    sums.replaceChildren(...ids.map((id) => {
      let ref = rowsById.get(id);
      if (ref) return ref.el;
      const c = withBlank.find((x) => x.id === id);
      if (!c) return null;
      const sumEl = h('p', { class: 'muted small' }, '');
      const ti = textInput({
        label: `Наценка для ${c.name}, %`,
        value: String(markups.get(id) ?? 0),
        type: 'number',
        onInput: (v) => { markups.set(id, Number(v) || 0); updateSumText(id); },
      });
      const el = stack(ti.el, sumEl);
      ref = { el, sumEl, ti };
      rowsById.set(id, ref);
      updateSumText(id);
      return el;
    }).filter(Boolean));
    syncSave();
  };

  if (!others.length || !withBlank.length) {
    // некого выбрать (нет фирм или все без бланка) — та же подсказка, не toast «Других фирм нет»
    const names = noBlank.length ? noBlank.map((c) => c.name) : ['добавьте другую нашу фирму с бланком'];
    const el = stack(
      h('p', { class: 'muted small' }, `Исходное КП ${r.number || ''} · ${money(r.total || 0)}.`),
      blankNote(names),
    );
    return {
      el, dirty: () => false, focus: () => {},
      bindSave: (fn) => { setSave = fn; setSave(false, 'Создать КП'); },
      read: () => ({ errors: { firms: 1 } }),
    };
  }

  const tp = tagPick({
    label: 'Фирмы',
    options: withBlank.map((c) => ({ value: c.id, label: c.name })),
    value: prefIds,
  });
  tp.el.addEventListener('change', () => {
    let ids = [];
    try { ids = (JSON.parse(tp.value) || []).map(String); } catch { ids = []; }
    rebuildRows(ids);
  });

  syncBlank();
  rebuildRows(prefIds);

  const el = stack(
    h('p', { class: 'muted small' }, `Исходное КП ${r.number || ''} · ${money(r.total || 0)}. У каждой фирмы — своя наценка; бланк и НДС подставятся сами.`),
    summary,
    tp.el,
    blankBox,
    sums,
  );

  return {
    el,
    dirty: () => true,
    focus: () => {},
    bindSave: (fn) => { setSave = fn; syncSave(); },
    read: () => ({
      values: {
        save: async () => {
          let ids = [];
          try { ids = (JSON.parse(tp.value) || []).map(String); } catch { ids = []; }
          const picked = withBlank.filter((c) => ids.includes(c.id));
          if (!picked.length) throw new Error('Отметьте хотя бы одну фирму');
          for (const c of picked) {
            const pct = Number(markups.get(c.id) ?? 0);
            if (pct < -50 || pct > 200) throw new Error(`Наценка для «${c.name}» — от −50 до 200 %`);
          }
          writePrefs({ companies: picked.map((c) => ({ id: c.id, markup: Number(markups.get(c.id) ?? 0) })) });
          const res = await api(`/offers/${r.id}/copies`, {
            method: 'POST',
            body: { companies: picked.map((c) => ({ companyId: c.id, markupPercent: Number(markups.get(c.id) ?? 0) })) },
          });
          toast(`Создано КП: ${res.items?.length || picked.length}`);
          return res;
        },
      },
    }),
  };
}

/** Раздел правой панели: ?of=offerpack&open=<id КП>. */
export const offerPack = {
  id: 'offerpack',
  title: 'КП',
  newTitle: 'КП от других фирм',
  get: (id) => api(`/offers/${id}`),
  card: {
    heading: () => 'КП от других фирм',
    subheading: (r) => [r.number, r.companyName, r.total ? money(r.total) : null].filter(Boolean).join(' · '),
    editTitle: () => 'КП от других фирм',
    startEdit: () => true,
    view: () => [],
    noHistory: true,
  },
  form: {
    build: (row) => buildPackForm(row),
    toBody: (v) => v,
    update: async (id, v) => { await v.save(); return { id }; },
    closeAfterCreate: true,
    saveLabel: 'Создать КП',
  },
};

/** @deprecated модалка убрана — открываем панель. */
export function packCopyDialog(r) {
  openOfferPack(r.id);
}

const READY = { ok: { label: 'Можно отправлять', tone: 'ok' }, bad: { label: 'Не хватает', tone: 'danger' } };

/** C080: список «чего не хватает» или зелёная строка «Можно отправлять». */
function readyLines(problems) {
  if (!problems.length) return stack(badge(READY, 'ok'));
  return stack(badge(READY, 'bad'), ...problems.map((p) => h('p', { class: 'hint' }, p)));
}

/** C080: проверка одного КП (не в пакете) перед отправкой; только для черновика. */
function readyBlock(r) {
  if (r.packId || r.status !== 'draft') return null;
  const box = stack(h('p', { class: 'muted small' }, 'Проверяю КП…'));
  api(`/offers/${r.id}/check`)
    .then((c) => box.replaceChildren(readyLines(c.offer?.problems || [])))
    .catch(() => box.replaceChildren(h('p', { class: 'muted small' }, 'Не удалось проверить КП')));
  return stack(section({ title: 'Проверка перед отправкой', tone: 'money', open: true, body: [box] }));
}

/** Блок «Пакет» в карточке КП. */
export function packBlock(r) {
  if (!r.packId) return readyBlock(r); // C080: КП вне пакета — своя проверка
  const box = stack(h('p', { class: 'muted' }, 'Загрузка пакета…'));
  const load = async () => {
    try {
      const [list, chk] = await Promise.all([
        api('/offers', { query: { packId: r.packId, limit: 50 } }),
        api(`/offers/${r.id}/check`).catch(() => null),
      ]);
      const items = list.items || [];
      const hasDraft = items.some((o) => o.status === 'draft');
      const checkBox = chk?.pack ? stack(
        readyLines(chk.pack.problems || []),
        hasDraft ? button({
          label: 'Отправить пакет', size: 'S', kind: 'primary', disabled: !chk.pack.ready,
          onClick: async () => {
            const n = items.filter((o) => o.status === 'draft').length;
            if (!(await confirmDlg('Отправить пакет', `Отправить ${n} КП?`, { okText: 'Отправить' }))) return;
            try {
              const res = await api(`/offers/packs/${r.packId}/send`, { method: 'POST', body: {} });
              toast(`Отправлено КП: ${res.sent}`);
              await load();
            } catch (e) { toastError(e, 'отправить пакет'); }
          },
        }) : null,
      ) : null;
      const zipBtn = button({
        label: `Скачать все PDF (${items.length})`, size: 'S',
        onClick: async () => {
          try {
            await downloadPackZip(items, r.number || r.packId.slice(0, 8));
            toast(`Скачан архив: ${items.length} PDF`);
          } catch (e) { toastError(e, 'скачать PDF пакета'); }
        },
      });
      box.replaceChildren(
        ...(checkBox ? [checkBox] : []),
        zipBtn,
        ...items.map((o) => {
          const mine = String(o.id) === String(r.id);
          return row({
            title: o.companyName || '—',
            meta: stack(
              h('span', { class: 'num' }, o.total ? money(o.total) : 'без цены'),
              badge(STATUS, o.status),
              mine ? h('span', { class: 'muted small' }, 'это КП') : null,
            ),
            side: mine ? null : button({ label: 'Открыть', size: 'S', kind: 'ghost', onClick: () => go('offers', { open: o.id }) }),
            wrap: true,
          });
        }),
      );
    } catch {
      box.replaceChildren(h('p', { class: 'muted' }, 'Не удалось загрузить пакет'));
    }
  };
  load();
  return stack(section({ title: 'Пакет', tone: 'money', open: true, body: [box] }));
}

/** Метка в списке: «пакет из N». */
export function packListMark(r) {
  if (!r.packId || !(r.packSize > 1)) return null;
  return h('span', { class: 'muted small' }, ` · пакет из ${r.packSize}`);
}
