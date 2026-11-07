import { h } from '../../../core/dom.js';
import { patch } from '../../../core/router.js';
import { busyBlock, link, section, sideNote, stack, toastError } from '../../../ui/kit/index.js';
import { canEdit } from '../common.js';
import { getProduct } from './api.js';
import { gapsBlock } from './gaps.js';
import { issueBlock } from './issue.js';
import { newProduct } from './new-product.js';
import { takePending } from './open.js';
import { pickSteps } from './pick-steps.js';
import { productList } from './product-list.js';
import { textsBlock } from './texts.js';

/**
 * Воронка «Новый паспорт» (C028, docs/crew/C028-passport-funnel/ANALYSIS.md §4): одна правая панель, сверху вниз
 * Категория → Группа → признаки → Изделие → Чего не хватает → Тексты → Выпуск. Ответы пишутся в изделие и не спрашиваются дважды.
 * Шаги и «Дальше: …» — эталон kit.funnel (П-1); пройденное — строка «Категория: … ✎».
 */
const FACET_FREE = (P) => Object.entries(P).filter(([k, v]) => v && k !== 'category' && k !== 'group').flatMap(([, v]) => String(v).split(',')).filter((id) => id && id !== 'none');
const setCount = (sec, n) => sec.querySelector('.k-sec-head .k-sec-n')?.replaceChildren(String(n));

function build() {
  const entry = takePending();
  const S = { P: {}, q: '', prod: null };
  const recap = stack();
  const stages = stack();
  const newBox = h('div', null);
  const say = (t) => ps.setNext(t); // «Дальше: …» — строка kit.funnel над шагами
  // заголовок панели называет изделие (приёмка дизайнера D1); до выбора — «Новый паспорт»
  const title = (t, again = true) => { const hd = ps.el.closest('.drawer, .k-panel')?.querySelector('h2'); if (hd) hd.textContent = t; else if (again) setTimeout(() => title(t, false), 0); }; // вход из карточки: панель ещё не вставлена

  // ── шаги 1–4 ──
  const ps = pickSteps({
    getQ: () => S.q,
    onData: (resp) => {
      pl.paint(resp.products); pl.gate(ps.ready() || !!S.q);
      const s = (resp.steps || []).find((x) => !S.P[x.key] && !x.skip && (x.values || []).length > 1);
      say(s ? null : 'выберите изделие в списке');
    },
    onChange: (P, key) => {
      const order = ps.order(); const i = order.indexOf(key);
      order.slice(i + 1).forEach((k) => delete P[k]);
      S.P = Object.fromEntries(Object.entries(P).filter(([, v]) => v));
      if (S.prod || !newBox.hidden) showPick(); else ps.update(S.P);
    },
  });
  const pl = productList({
    onPick: (it) => choose(it.id),
    onSearch: (q) => { S.q = q; ps.update(S.P); },
    onNew: () => {
      newBox.replaceChildren(newProduct({ group: ps.labelOf('group', S.P.group), facetIds: FACET_FREE(S.P), onCreated: (p) => choose(p), onPickExisting: (it) => choose(it.id), onCancel: showPick }).el);
      pickBox.hidden = true; newBox.hidden = false; ps.setDone(true); say('введите название нового изделия');
    },
  });
  const pickBox = stack(pl.el);
  newBox.hidden = true;

  function showPick() {
    S.prod = null; stages.replaceChildren(); recap.replaceChildren(); title('Новый паспорт');
    newBox.hidden = true; pickBox.hidden = false; ps.setDone(false); say(null); ps.update(S.P);
  }

  // ── шаги 5–7 ──
  async function choose(src) {
    try {
      const prod = typeof src === 'string' ? await getProduct(src) : src;
      S.prod = prod; pickBox.hidden = true; newBox.hidden = true; ps.setDone(true); title('Паспорт: ' + (prod.name || 'изделие'));
      const sku = prod.sku ? prod.sku + ' ' : '';
      recap.replaceChildren(link({ label: `Изделие: ${sku}${prod.name} ✎`, title: 'Выбрать другое изделие', onClick: showPick }));
      stagePanels(prod);
    } catch (e) { toastError(e, 'открыть изделие'); }
  }

  function stagePanels(prod) {
    let loadedFor = '';
    const texts = textsBlock({ prod });
    const gapsSec = section({ title: 'Чего не хватает', tone: 'main', count: 0, open: true, body: busyBlock('данные изделия') });
    const textsSec = section({ title: 'Тексты', tone: 'info', body: texts.el });
    const issueSec = section({ title: 'Выпуск', tone: 'gold', open: false, body: [] });
    const issue = issueBlock({ prod, goGaps: () => { gapsSec.open = true; }, onIssued: () => patch({ of: undefined, new: undefined }) });
    issueSec.querySelector('.k-sec-body').replaceChildren(issue.el);
    const catCode = () => prod.category?.code || prod.passportDefaults?.passportCategory || '';
    textsSec.addEventListener('toggle', () => {
      if (!textsSec.open || loadedFor === catCode()) return;
      if (!catCode()) { texts.el.replaceChildren(sideNote('Сначала укажите категорию в блоке «Чего не хватает».')); return; }
      loadedFor = catCode(); texts.load(loadedFor);
    });

    const onLoad = (missing) => {
      const must = missing.filter((m) => m.required);
      setCount(gapsSec, missing.length);
      issue.paint(must);
      say(must.length ? `укажите «${must[0].label}»` : 'выпустите PDF (тексты уже подставлены)');
      if (!must.length) { gapsSec.open = false; issueSec.open = true; }
    };
    const gaps = gapsBlock({ prod, onLoad });
    const nextBtn = h('div', null, link({ label: 'Дальше — к выпуску →', onClick: async () => { try { const must = await gaps.commit(); if (must.length) return; gapsSec.open = false; issueSec.open = true; } catch (e) { toastError(e, 'сохранить'); } } }));
    gapsSec.querySelector('.k-sec-body').replaceChildren(gaps.el, nextBtn);
    stages.replaceChildren(gapsSec, textsSec, issueSec);
    gaps.reload().catch((e) => { gaps.el.replaceChildren(sideNote('Не удалось узнать, чего не хватает.')); toastError(e, 'проверить изделие'); });
  }

  // старт: вход Б — сразу к изделию; вход А — с категории
  if (entry) { say('проверьте недостающее'); choose(entry.productId); } else ps.update({});

  const el = stack(ps.el, recap, pickBox, newBox, stages);
  return { el, readonly: true, dirty: () => false, focus: () => {}, read: () => ({ values: {} }) };
}

export const passFunnel = {
  id: 'passfunnel', title: 'Паспорта', newTitle: 'Новый паспорт', canEdit,
  card: { heading: () => 'Новый паспорт' },
  get: async () => ({}),
  form: { build, toBody: (v) => v, create: () => ({}), closeAfterCreate: true },
};
