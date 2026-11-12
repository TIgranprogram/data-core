// Окно блока «Карты сайта» (C097): шаги сверху вниз, связи в свой шаг, «Учитывать», «Частые задачи», где описано.
import { h } from '../core/dom.js';
import { guide, button, toolbar, toast } from '../ui/kit/index.js';
import { SECTIONS, SCENARIOS } from './help-guide-data.js';
import { productMapCat } from './help-product-map.js';
import { BANDS, NODES, LINKS } from './atlas-data.js';
import { atlasBrief } from './atlas-brief.js';
import { s, byId, tone, nameOf, hrefOf, fit, roundPath, planLabel } from './atlas-util.js';

// ---------- окно «что внутри»: шаги сверху вниз; слева — что и в какой шаг приходит, справа — откуда уходит ----------
function inner(n, open) {
  const parts = n.inside || [], chain = parts.filter((p) => !p.alt), extra = parts.filter((p) => p.alt);
  const ins = LINKS.filter(([, b]) => b === n.id), outs = LINKS.filter(([a]) => a === n.id);
  const W2 = 960, SW = 210, SH = 58, PW = 300, PH = 58, CX = 330, RX = W2 - 10 - SW;
  const GAP = n.seq ? 30 : 14, TOPY = 70;
  // где стоит каждая часть: цепочка, затем «ещё в разделе»
  const pos = new Map();
  let y = TOPY;
  chain.forEach((p) => { pos.set(p, y); y += PH + GAP; });
  const extraY = y + (extra.length ? 10 : 0);
  if (extra.length) y = extraY + 22;
  extra.forEach((p) => { pos.set(p, y); y += PH + 14; });
  const partsBottom = y - (extra.length ? 14 : GAP);
  const partOf = (key, id) => parts.find((p) => (p[key] || []).includes(id)) || (key === 'in' ? parts[0] : parts[parts.length - 1]);
  // соседи: напротив своего шага, без наложений
  const place = (list, key) => {
    // связь может касаться нескольких шагов (например, счёт до оплаты и после): блок соседа — напротив первого, линии — ко всем
    const rows = list.map((l) => { const id = key === 'in' ? l[0] : l[1]; const all = parts.filter((p) => (p[key] || []).includes(id));
      return { l, id, part: all[0] || partOf(key, id), parts: all.length ? all : [partOf(key, id)] }; })
      .map((r) => ({ ...r, want: pos.get(r.part) + PH / 2 - SH / 2 })).sort((a, b) => a.want - b.want);
    let next = 10;
    rows.forEach((r) => { r.y = Math.max(r.want, next); next = r.y + SH + 10; });
    return rows;
  };
  const L = place(ins, 'in'), R = place(outs, 'out');
  const H = Math.max(partsBottom, ...L.map((r) => r.y + SH), ...R.map((r) => r.y + SH)) + 16;
  const svg = s('svg', { viewBox: `0 0 ${W2} ${H}`, width: '100%', role: 'group', 'aria-label': `${nameOf(n)}: шаги и связи` });
  const toks = [...new Set([tone(n), ...BANDS.map((b) => b.tok)])];
  svg.append(s('defs', {}, ...toks.map((t) => s('marker', { id: `at-in-${t}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' },
    s('path', { d: 'M0,0 L10,5 L0,10 z', fill: `var(--sec-${t})` })))));
  const tok = tone(n);
  // рамка раздела
  svg.append(s('rect', { x: CX - 18, y: 8, width: PW + 36, height: partsBottom - 8 + 14, rx: 14, fill: n.plan ? 'var(--surface-2)' : n.big ? 'var(--primary-soft)' : `var(--sec-${tok}-soft)`,
    stroke: n.plan ? 'var(--muted)' : n.big ? 'var(--primary)' : `var(--sec-${tok})`, 'stroke-width': 2, 'stroke-dasharray': n.plan ? '6 4' : null }),
    s('text', { x: CX, y: 36, fill: 'var(--heading)', 'font-size': 18, 'font-weight': 700 }, nameOf(n)),
    s('text', { x: CX, y: 55, fill: 'var(--muted)', 'font-size': 12 }, n.seq ? 'шаги по порядку, сверху вниз' : 'из чего состоит'));
  if (extra.length) svg.append(s('text', { x: CX, y: extraY + 12, fill: 'var(--muted)', 'font-size': 12, 'font-weight': 700 }, 'Ещё в разделе'));
  // линии соседей: прямые отрезки, у каждой своя вертикаль
  const lines = (rows, left) => {
    const per = new Map(); rows.forEach((r) => r.parts.forEach((pt) => per.set(pt, (per.get(pt) || 0) + 1)));
    const seen = new Map();
    rows.forEach((r, k) => r.parts.forEach((part) => {
      const m = per.get(part), q = (seen.set(part, (seen.get(part) || 0) + 1).get(part)) - 1;
      const yp = pos.get(part) + PH / 2 + (q - (m - 1) / 2) * 12, ys = r.y + SH / 2;
      const t = tone(byId.get(r.id));
      const xa = left ? 10 + SW : CX + PW, xb = left ? CX : RX;
      const xc = left ? 10 + SW + 22 + k * 11 : CX + PW + 22 + k * 11;
      const pts = Math.abs(yp - ys) < 1 ? [[xa, ys], [xb, ys]] : left ? [[xa, ys], [xc, ys], [xc, yp], [xb, yp]] : [[xa, yp], [xc, yp], [xc, ys], [xb, ys]];
      svg.append(s('path', { d: roundPath(pts, 6), fill: 'none', stroke: `var(--sec-${t})`, 'stroke-width': 1.8, 'marker-end': `url(#at-in-${t})` }));
    }));
  };
  lines(L, true); lines(R, false);
  // шаги
  chain.forEach((p, i) => {
    const py = pos.get(p);
    if (n.seq && i < chain.length - 1) svg.append(s('path', { d: `M${CX + PW / 2},${py + PH} L${CX + PW / 2},${py + PH + GAP}`, stroke: `var(--sec-${tok})`, 'stroke-width': 2, 'marker-end': `url(#at-in-${tok})` }));
  });
  parts.forEach((p, i) => {
    const py = pos.get(p), num = n.seq && !p.alt ? chain.indexOf(p) + 1 : null, tx = CX + (num ? 38 : 12);
    svg.append(s('g', {}, s('rect', { x: CX, y: py, width: PW, height: PH, rx: 9, fill: p.plan ? 'var(--surface-2)' : 'var(--surface)', stroke: p.plan ? 'var(--muted)' : p.alt ? 'var(--border)' : 'var(--border-strong)', 'stroke-dasharray': p.alt || p.plan ? '4 3' : null, 'stroke-opacity': p.plan ? '.7' : null }),
      p.plan ? s('text', { x: CX + PW - 10, y: py + 22, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 12, 'font-weight': 700 }, planLabel(p.plan)) : null,
      num ? s('circle', { cx: CX + 19, cy: py + PH / 2, r: 11, fill: `var(--sec-${tok})` }) : null,
      num ? s('text', { x: CX + 19, y: py + PH / 2 + 4, 'text-anchor': 'middle', fill: 'var(--surface)', 'font-size': 12, 'font-weight': 700 }, String(num)) : null,
      s('text', { x: tx, y: py + 22, fill: 'var(--heading)', 'font-size': 13, 'font-weight': 700 }, p.t),
      ...fit(p.l, num ? 37 : 41, 2).map((t, j) => s('text', { x: tx, y: py + 39 + j * 14, fill: 'var(--muted)', 'font-size': 12 }, t))));
  });
  // соседи
  const sideBox = (r, x, left) => {
    const m = byId.get(r.id), t = tone(m);
    const g = s('g', { tabindex: 0, role: 'button', cursor: 'pointer', 'aria-label': `Перейти: ${nameOf(m)}${m.plan ? ' (в разработке)' : ''}` },
      s('rect', { x, y: r.y, width: SW, height: SH, rx: 9, fill: m.plan ? 'var(--surface-2)' : `var(--sec-${t}-soft)`, stroke: m.plan ? 'var(--muted)' : `var(--sec-${t})`, 'stroke-dasharray': m.plan ? '5 3' : null, 'stroke-opacity': m.plan ? '.7' : null }),
      s('text', { x: x + 10, y: r.y + 21, fill: 'var(--heading)', 'font-size': 14, 'font-weight': 700 }, nameOf(m)),
      ...fit((left ? 'даёт: ' : 'получает: ') + r.l[2], 28, 2).map((tt, j) => s('text', { x: x + 10, y: r.y + 38 + j * 14, fill: 'var(--muted)', 'font-size': 12 }, tt)));
    g.addEventListener('click', () => open(r.id));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(r.id); } });
    return g;
  };
  L.forEach((r) => svg.append(sideBox(r, 10, true)));
  R.forEach((r) => svg.append(sideBox(r, RX, false)));
  return svg;
}

/** Узкий экран: та же декомпозиция словами — откуда, что внутри, куда (соседи — кнопки). */
function innerList(n, open) {
  const ins = LINKS.filter(([, b]) => b === n.id), outs = LINKS.filter(([a]) => a === n.id);
  const near = (list, pick) => h('ul', null, ...list.map((l) => h('li', null, button({ label: nameOf(byId.get(pick(l))), size: 'S', onClick: () => open(pick(l)) }), ' — ', l[2])));
  return h('div', null,
    ins.length ? guide.unit({ name: 'Откуда приходят сведения', foot: near(ins, (l) => l[0]) }) : null,
    guide.unit({ name: n.seq ? 'Шаги по порядку' : 'Из чего состоит', foot: h(n.seq ? 'ol' : 'ul', null, ...(n.inside || []).map((p) => h('li', null, h('b', null, p.t), ' — ', p.l, p.alt ? ' (ещё в разделе)' : ''))) }),
    outs.length ? guide.unit({ name: 'Куда уходят', foot: near(outs, (l) => l[1]) }) : null);
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
  const ins = LINKS.filter(([, b]) => b === n.id).length, outs = LINKS.filter(([a]) => a === n.id).length;
  return [
    nav,
    n.plan ? guide.note(n.plan === 'идея'
      ? { label: 'Идея', text: 'Раздела нет и в очереди задач его нет. Это предложение — скажите, брать ли его в работу. Ниже — как он мог бы выглядеть.', tone: 'warn' }
      : { label: 'В разработке', text: 'Раздела пока нет на сайте. Ниже — как он задуман.', tone: 'warn' }) : null,
    h('p', null, what),
    h('p', { class: 'muted small' }, `${n.seq ? 'Шаги идут сверху вниз по порядку. ' : ''}Слева — что приходит (${ins}) и в какой шаг, справа — что уходит (${outs}) и откуда. Нажмите соседний блок — окно перейдёт к нему.`),
    window.matchMedia('(min-width: 1100px)').matches ? inner(n, open) : innerList(n, open),
    // «Я хочу…» — частые задачи этого раздела (бывший общий блок «С чего начать?», 2026-11-12)
    wants.length ? h('section', null, h('h3', null, 'Частые задачи'), h('div', { class: 'g-wants' }, ...wants.map((sc) => guide.want({ tok: sc.tok, want: sc.want, menu: sc.menu, href: sc.href, start: sc.start })))) : null,
    n.productMap ? productMapCat() : null, // схема изделия и таблица «Где живёт и где править» (бывшая #help)
    n.rules?.length ? h('div', null, ...n.rules.map((t) => guide.note({ label: 'Учитывать', text: t, tone: 'warn' }))) : null,
    sec?.steps?.length ? guide.cat({ title: 'Как работать — по шагам', what: 'Что за чем нажимать в этом разделе', count: `${sec.steps.length} шаг.`, body: [guide.chain(sec.steps)] }) : null,
    n.docs?.length || n.tech ? guide.cat({ title: 'Где описано', what: 'Документы проекта — для ИИ и разработчика', count: 'доки',
      body: [h('ul', null, ...(n.docs || []).map((d) => h('li', null, d))), n.tech ? h('p', { class: 'muted small' }, `Таблицы базы: ${n.tech}`) : null] }) : null,
  ];
}
