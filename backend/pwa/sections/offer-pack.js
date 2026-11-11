/**
 * C071: «КП от других фирм» — выбор фирм с наценкой, блок «Пакет», ZIP PDF.
 * Только фабрики kit и базовые классы (muted/small/hint/num) — без of-* и сырых button/input (design-lint L2/L3).
 */
import { api, apiBlob } from '../core/api.js';
import { h } from '../core/dom.js';
import { money } from '../core/format.js';
import { go } from '../core/router.js';
import { button, modal, badge, stack, section, tagPick, textInput } from '../ui/kit/index.js';
import { toast, toastError } from '../ui/kit/toast.js';

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

/** Модалка: фирмы (tagPick) + наценка на фирму → POST /copies. */
export async function packCopyDialog(r, { refresh } = {}) {
  const all = await api('/offers/companies').then((x) => x?.items || []).catch(() => []);
  const others = all.filter((c) => String(c.id) !== String(r.companyId));
  if (!others.length) { toast('Других наших фирм нет'); return; }
  const withBlank = others.filter((c) => c.hasBlank);
  const noBlank = others.filter((c) => !c.hasBlank);
  const prefs = readPrefs();
  const prefMap = new Map((prefs.companies || []).map((p) => [String(p.id), Number(p.markup) || 0]));
  const prefIds = (prefs.companies || []).map((p) => String(p.id)).filter((id) => withBlank.some((c) => c.id === id));

  const markups = new Map(withBlank.map((c) => [c.id, prefMap.has(c.id) ? prefMap.get(c.id) : 0]));
  const summary = h('p', { class: 'hint' }, '');
  const sums = stack();
  const markupFields = new Map();

  const paintSums = (ids) => {
    summary.textContent = ids.length
      ? `Получится ${ids.length + 1} КП: ${r.companyName || 'исходное'}, ${withBlank.filter((c) => ids.includes(c.id)).map((c) => c.name).join(', ')}`
      : 'Отметьте фирмы — получится пакет с исходным КП.';
    const okBtn = summary.closest?.('form')?.querySelector?.('.modal-foot .btn-primary');
    if (okBtn) okBtn.textContent = ids.length ? `Создать ${ids.length} КП` : 'Создать КП';
    sums.replaceChildren(...ids.map((id) => {
      const c = withBlank.find((x) => x.id === id);
      if (!c) return null;
      let ti = markupFields.get(id);
      if (!ti) {
        ti = textInput({
          label: `Наценка для ${c.name}, %`,
          value: String(markups.get(id) ?? 0),
          type: 'number',
          onInput: (v) => { markups.set(id, Number(v) || 0); paintSums(ids); },
        });
        markupFields.set(id, ti);
      }
      const pct = Number(markups.get(id) ?? 0);
      const sum = marked(Number(r.total) || 0, pct);
      return stack(ti.el, h('p', { class: 'muted small' }, `+${pct} % · ${money(sum)}`));
    }).filter(Boolean));
  };

  const tp = tagPick({
    label: 'Фирмы',
    options: withBlank.map((c) => ({ value: c.id, label: c.name })),
    value: prefIds,
  });
  tp.el.addEventListener('change', () => {
    let ids = [];
    try { ids = JSON.parse(tp.value) || []; } catch { ids = []; }
    paintSums(ids.map(String));
  });
  paintSums(prefIds);

  const noBlankNote = noBlank.length
    ? h('p', { class: 'muted small' },
      `Без бланка (нельзя выбрать): ${noBlank.map((c) => c.name).join(', ')}. `,
      button({ label: 'Наши компании', size: 'S', kind: 'ghost', onClick: () => go('partners') }))
    : null;

  const body = stack(
    h('p', { class: 'muted small' }, `Исходное КП ${r.number || ''} · ${money(r.total || 0)}. У каждой фирмы — своя наценка; бланк и НДС подставятся сами.`),
    summary, tp.el, sums, noBlankNote);

  const n0 = prefIds.length;
  await modal({
    title: 'КП от других фирм',
    okText: n0 ? `Создать ${n0} КП` : 'Создать КП',
    wide: true,
    body,
    onOk: async () => {
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
      if (typeof refresh === 'function') await refresh(res);
      else go('offers', { open: r.id });
      return true;
    },
  });
}

/** Блок «Пакет» в карточке КП. */
export function packBlock(r) {
  if (!r.packId) return null;
  const box = stack(h('p', { class: 'muted' }, 'Загрузка пакета…'));
  const load = async () => {
    try {
      const list = await api('/offers', { query: { packId: r.packId, limit: 50 } });
      const items = list.items || [];
      const zipBtn = button({
        label: 'Скачать все PDF', size: 'S',
        onClick: async () => {
          try {
            await downloadPackZip(items, r.number || r.packId.slice(0, 8));
            toast(`Скачан архив: ${items.length} PDF`);
          } catch (e) { toastError(e, 'скачать PDF пакета'); }
        },
      });
      box.replaceChildren(
        stack(h('b', null, `Пакет из ${items.length}`), zipBtn),
        ...items.map((o) => {
          const mine = String(o.id) === String(r.id);
          const label = [o.companyName || '—', o.number || '', o.total ? money(o.total) : 'без цены'].filter(Boolean).join(' · ');
          return stack(
            button({
              label: mine ? `● ${label}` : label,
              size: 'S',
              kind: mine ? 'secondary' : 'ghost',
              onClick: () => go('offers', { open: o.id }),
            }),
            badge(STATUS, o.status));
        }),
      );
    } catch {
      box.replaceChildren(h('p', { class: 'muted' }, 'Не удалось загрузить пакет'));
    }
  };
  load();
  return stack(section({ title: 'Пакет', tone: 'who', open: true, body: [box] }));
}

/** Метка в списке: «пакет из N». */
export function packListMark(r) {
  if (!r.packId || !(r.packSize > 1)) return null;
  return h('span', { class: 'muted small' }, ` · пакет из ${r.packSize}`);
}
