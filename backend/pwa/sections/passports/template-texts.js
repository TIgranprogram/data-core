import { api } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { withVars } from '../passport-texts.js';
import { actions, badge, button, buildForm, empty, hint, section, stack, table, toast } from '../../ui/kit/index.js';

/**
 * Последний блок шаблона паспорта: «Тексты этого изделия» (C060). Таблица текстов, которые войдут в паспорт именно этого изделия
 * (выбранные варианты воронки), с действиями «Изменить» (свой текст только для изделия), «Убрать из паспорта», «Вернуть».
 * Сохраняется в изделие (passportDefaults.textOverrides: { id раздела: { text } | { off } }); справочник не меняется.
 *   ownTexts({ r, can, save }) → { el, load() }; save(job) — запись в изделие и обновление шаблона (из template-form.js).
 * Сервер: GET /passports/product-texts?productId=…
 */
export function ownTexts({ r, can, save }) {
  const body = h('div');
  const el = section({ title: 'Тексты этого изделия', fixed: true, tone: 'info', body });

  const setOverride = (id, value) => save(async () => {
    const cur = { ...(r.passportDefaults?.textOverrides || {}) };
    if (value) cur[id] = value; else delete cur[id];
    const { putDefaults } = await import('./funnel/api.js');
    await putDefaults(r, { textOverrides: cur });
  });

  let editing = null; // id раздела, текст которого правится прямо в строке
  let cache = [];

  function editCell(item) {
    const form = buildForm([{ key: 'text', label: `Текст «${item.name}» в паспорте этого изделия`, type: 'textarea', rows: 7, max: 4000, wide: true, required: true }], { text: item.text });
    return stack(
      hint('Текст попадёт в паспорт только этого изделия. Справочник «Тексты паспорта» и другие изделия не изменятся.'),
      form.el,
      actions(
        button({ label: 'Сохранить', size: 'S', kind: 'primary', onClick: async () => {
          const v = form.read();
          if (v.errors) { toast('Введите текст', 'warn'); return; }
          editing = null;
          await setOverride(item.id, { text: v.values.text.trim() });
          toast('Свой текст сохранён');
        } }),
        button({ label: 'Отмена', size: 'S', kind: 'ghost', onClick: () => { editing = null; paint(cache); } }),
      ),
    );
  }

  // 2026-11-10 (пользователь: «кнопка не нужна, места под текст много»): текст целиком, без «Развернуть»
  // метки {…} — понятными подписями, иначе сторож мусора прятал весь текст (ошибки сайта 12.11)
  const textCell = (item) => h('div', null, ...withVars(item.text || ''));

  function actionCell(item) {
    if (!can) return '';
    const btns = [];
    if (item.off) btns.push(button({ label: 'Вернуть', size: 'S', onClick: () => setOverride(item.id, null) }));
    else {
      btns.push(button({ label: 'Изменить', size: 'S', onClick: () => { editing = item.id; paint(cache); } }));
      if (item.own) btns.push(button({ label: 'Вернуть', size: 'S', kind: 'ghost', title: 'Вернуть текст из справочника', onClick: () => setOverride(item.id, null) }));
      if (item.canOff) btns.push(button({ label: 'Убрать из паспорта', size: 'S', kind: 'ghost', onClick: () => setOverride(item.id, { off: true }) }));
    }
    return actions(...btns);
  }

  function paint(items) {
    cache = items;
    if (!items.length) { body.replaceChildren(empty({ title: 'Тексты пока не подобраны', hint: 'Выберите категорию паспорта и варианты текстов выше — они появятся здесь.' })); return; }
    body.replaceChildren(
      hint('Индивидуальные тексты этого изделия, которые встанут в паспорт. Общие тексты «Для всех» здесь не показаны.'),
      table({
        label: 'Тексты этого изделия',
        cls: 'k-table-stack', // текст — вся свободная ширина; на телефоне строка-карточка
        columns: [{ label: 'Раздел', nowrap: true }, { label: 'Текст' }, { label: 'Действия', nowrap: true }],
        rows: items.map((it) => ({
          cells: [
            h('div', null, it.name, it.own ? badge('Свой текст', 'info') : null, it.off ? badge('Убрано из паспорта', 'warn') : null),
            editing === it.id ? editCell(it) : textCell(it),
            editing === it.id ? '' : actionCell(it),
          ],
        })),
      }),
    );
  }

  async function load() {
    if (!(r.passportDefaults?.passportCategory || r.passportCategory?.code)) { body.replaceChildren(hint('Сначала выберите категорию паспорта')); return; }
    try { paint((await api('/passports/product-texts', { query: { productId: r.id } })).items || []); }
    catch { body.replaceChildren(hint('Не удалось загрузить тексты', 'warn')); }
  }
  return { el, load };
}
