import { api } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { CAT_NAMES } from '../../core/passport-kinds.js';
import { formImages, modelImagesToForm } from '../../core/passport-images.js';
import { toast } from '../../ui/toast.js';
import { V2_NUMS, api_get, api_post, codeList, dictRows, isIssued, keyLines, kinds, kvLines, num, reqKinds, st } from './common.js';
import { DEFAULT_KEYS } from './models.js';

/** Связи формы паспорта (категория → состав, готовность к выпуску), замок выпущенного, «кто проектировал». */
/**
 * Связи формы паспорта (ФП), через form mount(api):
 * - категория → элементы / материалы / способы установки только своей категории (чужие выбранные — с пометкой, предупреждение),
 *   нормативы категории, умолчания (срок службы, гарантия, типовые ограничения) — серым, ручное не трогаем;
 * - выбрана модель → её картинки по видам в форму (видно до сохранения, без дублей);
 * - любое изменение → «Готовность к выпуску»: чего не хватает (POST /passports/check), ссылки к полям; кнопка «Выпустить».
 */
export function wireForm(api, { r, w, catBy, stdName, inst }) {
  const sel = api.input('installationTypeId');
  const drawer = api.root.closest('.drawer');
  const saveBtn = () => [...(drawer?.querySelectorAll('button.btn-primary') || [])].find((b) => /^(Создать|Выпустить|Сохранить)/.test(b.textContent.trim()));
  let lastCat = api.get('passportCategory');

  const scope = (warn) => {
    const code = api.get('passportCategory');
    const foreign = [...(w.el?.setScope(code) || []), ...(w.mat?.setScope(code) || [])];
    // способ установки: свои + уже выбранный (с пометкой)
    if (sel) {
      const cur = sel.value;
      const own = (o) => !code || !o.cats.length || o.cats.includes(code);
      const list = inst.filter((o) => own(o) || o.value === cur);
      sel.replaceChildren(h('option', { value: '' }, '—'), ...list.map((o) => h('option', { value: o.value }, own(o) ? o.label : `${o.label} — не для этой категории`)));
      sel.value = cur;
      const o = inst.find((x) => x.value === cur); if (o && !own(o)) foreign.push(o.label);
    }
    const c = catBy.get(code);
    const stds = codeList(c?.standards);
    w.std.textContent = !code ? 'Выберите категорию — здесь появятся её нормативы' : stds.length ? stds.map((s) => stdName.get(s) || s).join('; ') : 'У категории не указаны нормативы — «Справочники → Паспорта → Категории паспортов»';
    if (warn && foreign.length) toast(`Не для категории «${CAT_NAMES[code] || code}»: ${foreign.join(', ')}. Оставлено — уберите, если не нужно`, { ms: 8000 });
  };
  // умолчания категории: только в пустые поля или в то, что подставлено нами и не правилось руками
  const defaults = () => {
    const code = api.get('passportCategory'); const c = catBy.get(code);
    const vals = { serviceLifeYears: c?.serviceLifeYears, warrantyMonths: c?.warrantyMonths, ...kvLines(c?.fieldDefaults) };
    for (const [k, v] of Object.entries(vals)) {
      const inp = api.input(k); if (!inp || v === undefined || v === null || v === '') continue;
      if (api.manual(k) || (String(inp.value).trim() && !inp.classList.contains('is-default'))) continue;
      api.set(k, num(v), { auto: true });
    }
  };
  // обязательные картинки категории: «*» в подписи и раскрыть блок, где они лежат (блоки строятся до выбора категории)
  const markReq = () => {
    const rq = reqKinds(catBy.get(api.get('passportCategory')), api.get('isKit') === 'yes');
    for (const [k, label] of kinds()) {
      const sp = api.field('img_' + k)?.querySelector(':scope > span'); if (!sp) continue;
      sp.textContent = label + (rq.includes(k) ? ' *' : '');
      if (rq.includes(k)) api.open('img_' + k);
    }
  };
  // ПК: «Ограничения и техданные» — только поля категории (справочник: «Поля категории», обязательные — *);
  // неприменимое скрыто, уже заполненное — видно с пометкой; подсказки — свои для категории
  const numsByCat = () => {
    const c = catBy.get(api.get('passportCategory'));
    const allowed = keyLines(c?.allowedFields); const req = keyLines(c?.requiredFields); const hints = kvLines(c?.fieldHints);
    for (const [k, label, base] of V2_NUMS) {
      const fld = api.field(k); if (!fld) continue;
      const own = !c || !allowed.length || allowed.includes(k) || req.includes(k);
      const filled = String(api.get(k) ?? '').trim() !== '';
      fld.hidden = !own && !filled;
      const sp = fld.querySelector(':scope > span');
      if (sp) { sp.textContent = label + (req.includes(k) ? ' *' : ''); if (!own && filled) sp.append(h('span', { class: 'muted' }, ' · не для этой категории')); }
      let hn = fld.querySelector(':scope > .hint');
      const text = hints[k] || base || '';
      if (!hn && text) { hn = h('div', { class: 'hint' }); fld.querySelector(':scope > .err')?.before(hn); }
      if (hn) { hn.textContent = text; hn.hidden = !text; }
    }
  };
  // ПК: категория каталога — по категории паспорта (первое из «Категорий каталога»), если не задана изделием или руками
  const catalogByCat = () => {
    if (api.manual('category')) return;
    const cur = api.get('category'); const auto = api.input('category')?.classList?.contains('is-default');
    if (cur && !auto) return;
    const first = String(catBy.get(api.get('passportCategory'))?.catalogNames || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean)[0];
    if (first) api.set('category', first, { auto: true, src: 'по категории паспорта' });
  };
  api.on('passportCategory', () => {
    const code = api.get('passportCategory');
    if (code === lastCat) return;
    lastCat = code; scope(true); defaults(); markReq(); numsByCat(); catalogByCat(); check();
  });
  api.on('isKit', markReq);
  // ТЭ: способ установки → эталонный текст «Установки» категории (вариант справочника с тем же способом)
  const INSTALL_VARIANT = { CONCRETE_POSTS: 'Бетонирование опорных стоек', EMBEDDED: 'Закладные детали', ANCHORS: 'Анкерное крепление', FENCE_POSTS: 'Ограждение на опорных стойках', FREESTANDING: 'Свободная установка', ON_SURFACE: 'Свободная установка' };
  api.on('installationTypeId', async () => {
    if (api.manual('installationMethod')) return;
    const code = inst.find((o) => o.value === api.get('installationTypeId'))?.code;
    const variant = INSTALL_VARIANT[code]; if (!variant) return;
    const rows = await dictRows('passportPhrases');
    const hit = rows.find((x) => x.section === 'installation' && x.name === variant && codeList(x.categories).includes(api.get('passportCategory')));
    if (hit) api.set('installationMethod', hit.text, { auto: true, src: 'по способу установки' });
  });

  // модель выбрана → картинки модели по видам (только в пустые виды; своё не трогаем)
  api.on('_copyFrom', async () => {
    const id = api.get('_copyFrom'); if (!id) return;
    try {
      const m = await api_get(`/passports/${id}`);
      const by = modelImagesToForm(m.images || [], kinds().map(([k]) => k));
      for (const [k, list] of Object.entries(by)) { if (!list.length) continue; const cur = JSON.parse(api.get('img_' + k) || '[]'); if (!cur.length) api.set('img_' + k, JSON.stringify(list)); }
      api.set('_imgsFrom', id);
      check();
    } catch { /* картинки добавит сервер при сохранении */ }
  });

  // «Готовность к выпуску»
  let timer; let seq = 0;
  const json = (k) => { try { return JSON.parse(api.get(k) || '[]') || []; } catch { return []; } };
  const goTo = (key0) => {
    const key = key0 === 'materialIds' && api.field('_mspec') ? '_mspec' : key0; // МИ.4: метки материалов — из таблицы
    api.open(key);
    const fld = api.field(key); if (!fld) return;
    fld.scrollIntoView({ behavior: 'smooth', block: 'center' });
    fld.classList.add('fill-here'); setTimeout(() => fld.classList.remove('fill-here'), 2500);
    (api.input(key)?.focus || (() => {})).call(api.input(key));
  };
  const KEYS = ['name', 'category', 'date', 'supplierOrgId', 'height', 'length', 'width', 'weight', 'materials', 'installationMethod', 'purpose', 'description', 'customerName', 'objectName',
    'passportCategory', 'installationTypeId', 'isKit', ...V2_NUMS.map(([k]) => k)];
  const check = () => { clearTimeout(timer); timer = setTimeout(async () => {
    const my = ++seq;
    const body = { ...(r ? { date: r.date } : {}), ...Object.fromEntries(KEYS.map((k) => [k, api.get(k)]).filter(([, v]) => v !== '' && v != null)),
      elements: json('elements'), materialIds: json('materialIds'), images: formImages(Object.fromEntries(kinds().map(([k]) => ['img_' + k, json('img_' + k)])), kinds().map(([k]) => k)) };
    let res; try { res = await api_post('/passports/check', body); } catch { return; }
    if (my !== seq) return;
    const miss = res.missing || [];
    const who = miss.length ? await designerLine(api.get('productId')) : null;
    w.need.className = miss.length ? 'fill-note' : 'muted';
    w.need.replaceChildren(...(miss.length
      ? [h('b', null, `Не хватает для выпуска: ${miss.length}`), h('ul', { class: 'pp-need' }, ...miss.map((m) => h('li', null, m.key ? h('button', { type: 'button', class: 'link-btn', onclick: () => goTo(m.key) }, m.label) : m.label))),
        who, h('div', { class: 'hint' }, 'Черновик сохранить можно; выпустить (скачать PDF) — когда заполните всё отмеченное')]
      : [h('span', null, '✓ Всё есть — паспорт можно выпускать')]));
    const b = saveBtn();
    if (b && !b.disabled && !r) b.textContent = 'Сохранить черновик'; // НМ: номер — потом, кнопкой «Выпустить» в карточке
    // над кнопками — то же коротко: что ещё нужно для выпуска (ПП)
    if (b?.parentElement) {
      let foot = b.parentElement.querySelector('.pp-need-foot');
      if (!foot) { foot = h('div', { class: 'pp-need-foot' }); b.parentElement.prepend(foot); }
      foot.replaceChildren(...(miss.length ? [h('span', { class: 'muted' }, `Не хватает для выпуска: ${miss.slice(0, 4).map((m) => m.label).join(', ')}${miss.length > 4 ? ` и ещё ${miss.length - 4}` : ''}`)] : []));
      foot.hidden = !miss.length;
    }
  }, 500); };
  lockIssued(api, r);
  api.root.addEventListener('input', check); api.root.addEventListener('change', check);
  // ПИ.4: «Запомнить» — только если есть изделие и поправлены поля, которые изделие помнит
  const rememberField = api.field('_remember');
  const showRemember = () => { if (rememberField) rememberField.hidden = !(api.get('productId') && DEFAULT_KEYS.some((k) => api.manual(k))); };
  api.root.addEventListener('input', showRemember); api.root.addEventListener('click', () => setTimeout(showRemember));
  showRemember();
  scope(false); markReq(); numsByCat();
  if (!r && api.get('passportCategory')) { defaults(); catalogByCat(); }
  check();
}
/** НМ-1: выпущенный паспорт в форме — открыты только «после печати»; остальное — через «Новая редакция». */
export function lockIssued(api, r) {
  if (!r || !isIssued(r) || st.revisionFor === r.id) return;
  for (const blk of api.root.querySelectorAll('.form-block')) {
    const after = /после печати/i.test(blk.textContent.split('\n')[0] || '') || blk.querySelector('[name="saleDate"]');
    if (!after) { blk.inert = true; blk.classList.add('locked'); }
  }
  api.root.prepend(h('div', { class: 'fill-note' }, `Паспорт № ${r.passportNumber} выпущен: меняются только поля «после печати». Остальное — действие «Новая редакция» в карточке (номер тот же, редакция +1).`));
}
/** ПП: к кому идти, если не хватает данных, — «Кто проектировал» изделие (в паспорт и PDF не входит). */
export const designerCache = new Map();
export async function designerLine(productId) {
  if (!productId) return null;
  if (!designerCache.has(productId)) designerCache.set(productId, api(`/showcase/${productId}`).then((p) => p.designer || null).catch(() => undefined));
  const d = await designerCache.get(productId);
  if (d === undefined) return null;
  return h('div', { class: 'pp-designer' }, d ? `Спросить: ${d.name}${d.position ? ', ' + d.position : ''} (проектировал изделие)` : 'Проектировщик не указан — ',
    d ? null : h('a', { href: `#products?open=${productId}` }, 'указать в изделии'));
}
