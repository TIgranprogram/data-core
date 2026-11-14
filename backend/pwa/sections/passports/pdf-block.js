import { api } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { toast, toastError } from '../../ui/kit/toast.js';
import { button, row, section, sideNote, stack, table } from '../../ui/kit/index.js';
import { loadTexts } from '../passport-texts.js';
import { canEdit, dictRows, isIssued } from './common.js';
import { PASSPORT_TRAITS, fromText, itemTextOf, jointsPick, whenText } from './traits.js';

/**
 * «Что попадёт в PDF» (C054): какие признаки определены и откуда, что убрано условиями и почему.
 * Данные — textSnapshot.traits / traitsFrom / excluded / needJoints (сервер, снимок текста). Тяжёлое (тексты пунктов) — по раскрытию.
 */
const LEAD = /^\s*\d+(?:\.\d+)*\.?\s+/;

/** Подсказка «Выберите конструкцию» с выбором прямо здесь: сохранение пересобирает текст. */
function jointsAsk(r, ctx) {
  const pick = jointsPick(r.joints || []);
  const save = button({ label: 'Сохранить конструкцию', kind: 'primary', size: 'S', onClick: async () => {
    const joints = JSON.parse(pick.value);
    if (!joints.length) { toast('Отметьте хотя бы один вариант', { error: true }); return; }
    save.disabled = true; save.classList.add('is-busy');
    try { await api(`/passports/${r.id}`, { method: 'PATCH', body: { joints } }); ctx.setRow(await api(`/passports/${r.id}`)); toast('Конструкция сохранена, текст пересобран'); }
    catch (e) { toastError(e); save.disabled = false; save.classList.remove('is-busy'); }
  } });
  return stack(
    row({ tone: 'warn', title: 'Выберите конструкцию', meta: 'Болты, сварка или цельное — от этого зависит текст паспорта.' }),
    canEdit() ? stack(pick.el, save) : null);
}

/** Раскрываемый список «Не попали»: тексты пунктов подгружаются при открытии. */
function excludedList(r, ex) {
  const body = h('div', null);
  const sec = section({ title: 'Не попали в паспорт', count: ex.length, tone: 'neutral', body });
  let loaded = false;
  sec.addEventListener('toggle', async () => {
    if (!sec.open || loaded) return;
    loaded = true;
    body.replaceChildren(sideNote('Загружаю тексты…'));
    try {
      const [texts, defects] = await Promise.all([loadTexts(r.passportCategory), ex.some((e) => e.section === 'maintenance') ? dictRows('passportDefects') : []]);
      body.replaceChildren(...ex.map((e) => {
        const reason = e.unknown ? 'ждёт выбора конструкции' : `условие не совпало: ${whenText(e.when)}`;
        if (e.section === 'maintenance') {
          const d = defects.find((x) => String(x.code) === e.key);
          return row({ tone: e.unknown ? 'warn' : 'neutral', title: d?.name || 'Строка таблицы осмотра', meta: `Таблица осмотра · ${reason}` });
        }
        const it = itemTextOf(texts, e.section, e.key);
        const where = (it?.title || e.section).replace(LEAD, '');
        return stack(
          row({ tone: e.unknown ? 'warn' : 'neutral', title: where || 'Пункт текста', meta: reason }),
          h('p', { class: 'hint' }, it?.text || `Пункт ${e.key}`),
        );
      }));
    } catch (err) { loaded = false; body.replaceChildren(sideNote('Не удалось загрузить тексты.')); toastError(err); }
  });
  return sec;
}

export function pdfBlock(r, ctx) {
  const t = r.textSnapshot;
  if (!t || !Array.isArray(t.traits)) return null; // снимок собран до признаков — нечего показывать
  const ex = t.excluded || [];
  const traits = t.traits.length
    ? table({ columns: [{ label: 'Признак изделия' }, { label: 'Откуда' }], rows: t.traits.map((c) => ({ cells: [PASSPORT_TRAITS[c] || c, { v: fromText(t.traitsFrom?.[c]), cls: 'muted' }] })) })
    : h('p', { class: 'muted small' }, 'Признаки не определены: выберите вид изделия, материал и способ установки.');
  return section({ title: 'Что попадёт в PDF', tone: t.needJoints ? 'main' : 'info', open: !!t.needJoints, body: [
    h('p', { class: 'hint' }, 'В паспорт попадают только подходящие изделию пункты и строки осмотра.'),
    t.needJoints ? jointsAsk(r, ctx) : null,
    traits,
    (t.unknownTraits || []).length ? h('p', { class: 'hint' }, 'Пока не определено: ' + t.unknownTraits.map((c) => PASSPORT_TRAITS[c] || c).join(', ')) : null,
    ex.length ? excludedList(r, ex) : h('p', { class: 'muted small' }, 'Ничего не убрано: все пункты подходят.')] });
}
