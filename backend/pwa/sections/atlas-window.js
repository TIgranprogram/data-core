// Подробности блока «Карты сайта»: состав, шаги и связи с другими разделами.
import { h } from '../core/dom.js';
import { guide, button, link, toolbar, toast } from '../ui/kit/index.js';
import { SECTIONS, SCENARIOS } from './help-guide-data.js';
import { productMapCat } from './help-product-map.js';
import { NODES, LINKS } from './atlas-data.js';
import { atlasBrief } from './atlas-brief.js';
import { byId, nameOf, hrefOf, planLabel } from './atlas-util.js';

function partList(parts, ordered = false) {
  const relation = (label, ids) => ids?.length
    ? h('div', null, h('b', null, label), h('div', null, ids.map((id) => nameOf(byId.get(id))).join(', ')))
    : null;
  return h(ordered ? 'ol' : 'ul', { class: 'g-detail-parts', role: ordered ? null : 'list' }, parts.map((part) =>
    h('li', null, guide.cat({
      title: part.t, count: part.plan ? planLabel(part.plan) : null,
      body: [
        h('p', null, part.l),
        part.in?.length || part.out?.length ? h('div', { class: 'g-detail-part-links muted small' },
          relation('Источники', part.in), relation('Получатели', part.out)) : null,
      ],
    }))));
}

function relationList(title, entries, open) {
  if (!entries.length) return null;
  return h('section', { class: 'g-detail-section' },
    h('h2', null, title),
    h('ul', { class: 'g-detail-relations', role: 'list' }, entries.map(([id, what]) => {
      const node = byId.get(id);
      return h('li', null,
        link({ label: nameOf(node), onClick: () => open(id) }),
        node.plan ? h('span', { class: 'muted small' }, planLabel(node.plan)) : null,
        h('p', null, what));
    })));
}

function blockDetails(n, open) {
  const parts = n.inside || [];
  const incoming = [], outgoing = [];
  for (const [from, to, what] of LINKS) {
    if (to === n.id) incoming.push([from, what]);
    if (from === n.id) outgoing.push([to, what]);
  }
  const primary = parts.filter((part) => !part.alt), extra = parts.filter((part) => part.alt);
  return h('div', { class: 'g-detail' }, h('div', { class: 'g-detail-grid' },
    parts.length ? h('section', { class: 'g-detail-section g-detail-main' },
      h('h2', null, n.seq ? 'Шаги по порядку' : 'Что внутри'),
      primary.length ? partList(primary, n.seq) : null,
      extra.length ? h('h3', null, 'Ещё в разделе') : null,
      extra.length ? partList(extra) : null) : null,
    relationList('Откуда поступают данные', incoming, open),
    relationList('Куда передаются', outgoing, open)));
}

/** К какому блоку относится карточка «Я хочу…»: по адресу раздела, иначе по ключу раздела. */
const baseHref = (x) => (x || '').split('?')[0];
function scenarioNode(sc) {
  return (NODES.find((m) => !m.plan && baseHref(hrefOf(m)) === baseHref(sc.href)) || NODES.find((m) => m.sec === sc.sec))?.id;
}

export function detail(n, open, back, close) {
  const sec = n.sec ? SECTIONS[n.sec] : null, href = hrefOf(n);
  const what = sec?.what || n.l.join(' ');
  const go = n.plan ? h('span', { class: 'muted small' }, n.plan === 'идея' ? 'На сайте нет — это идея' : 'На сайте пока нет — в разработке')
    : href ? button({ label: `Открыть раздел «${nameOf(n)}»`, kind: 'primary', onClick: () => { close(); location.hash = href; } })
      : h('span', { class: 'muted small' }, `Где найти: ${n.where || 'из карточек и поиска'}`);
  const wants = SCENARIOS.filter((sc) => scenarioNode(sc) === n.id);
  // для ИИ и для коллег: сводка блока текстом (та же, что `dc atlas <блок>`) и ссылка, открывающая это окно
  const copy = async (text, ok) => { try { await navigator.clipboard.writeText(text); toast(ok); } catch { toast('Не удалось скопировать — браузер не дал доступ к буферу', { error: true }); } };
  const link = `${location.origin}${location.pathname}#atlas?n=${n.id}`;
  const nav = toolbar(back ? button({ label: `← ${nameOf(back)}`, onClick: () => open(back.id, true) }) : null, go,
    button({ label: 'Сводка для ИИ', kind: 'ghost', title: 'Скопировать сводку блока: шаги, связи, правила, код и документы — вставить в чат ИИ', onClick: () => copy(atlasBrief(n.id), 'Сводка скопирована — вставьте её в чат ИИ') }),
    button({ label: 'Ссылка на блок', kind: 'ghost', title: 'Скопировать ссылку, которая откроет это окно', onClick: () => copy(link, 'Ссылка скопирована') }));
  return [
    nav,
    n.plan ? guide.note(n.plan === 'идея'
      ? { label: 'Идея', text: 'Раздела нет и в очереди задач его нет. Это предложение — скажите, брать ли его в работу. Ниже — как он мог бы выглядеть.', tone: 'warn' }
      : { label: 'В разработке', text: 'Раздела пока нет на сайте. Ниже — как он задуман.', tone: 'warn' }) : null,
    h('p', null, what),
    href && n.where ? h('p', { class: 'muted small' }, n.where) : null,
    blockDetails(n, open),
    // «Я хочу…» — частые задачи этого раздела (бывший общий блок «С чего начать?», 2026-11-12)
    wants.length ? h('section', null, h('h3', null, 'Частые задачи'), h('div', { class: 'g-wants' }, ...wants.map((sc) => guide.want({ tok: sc.tok, want: sc.want, menu: sc.menu, href: sc.href, start: sc.start })))) : null,
    n.productMap ? productMapCat() : null, // памятка о редактировании продукции
    n.rules?.length ? h('div', null, ...n.rules.map((t) => guide.note({ label: 'Учитывать', text: t, tone: 'warn' }))) : null,
    sec?.steps?.length ? guide.cat({ title: 'Как работать — по шагам', what: 'Что за чем нажимать в этом разделе', count: `${sec.steps.length} шаг.`, body: [guide.chain(sec.steps)] }) : null,
    n.docs?.length || n.tech ? guide.cat({ title: 'Где описано', what: 'Документы проекта — для ИИ и разработчика', count: 'доки',
      body: [h('ul', null, ...(n.docs || []).map((d) => h('li', null, d))), n.tech ? h('p', { class: 'muted small' }, `Таблицы базы: ${n.tech}`) : null] }) : null,
  ];
}
