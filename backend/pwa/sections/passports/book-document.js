import { h } from '../../core/dom.js';
import { button } from '../../ui/kit/index.js';
import { heading } from './common.js';
import { buildBook } from './book-blocks.js';

export function bindBookScroll(scroller, tocPagesList, pages) {
  const markCurrent = (idx) => {
    [...tocPagesList.children].forEach((btn, i) => {
      const active = i === idx;
      btn.classList.toggle('is-current', active);
      if (active) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    });
  };
  let ticking = false;
  scroller.addEventListener('scroll', () => {
    if (ticking || !pages().length) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const top = scroller.scrollTop + 24;
      let current = 0;
      pages().forEach((p, i) => { if (p.offsetTop <= top) current = i; });
      markCurrent(current);
    });
  }, { passive: true });
  return markCurrent;
}

/** Разбивка проекции на листы и навигация по страницам. */
export function renderBookDocument({ ctx, pages, scroller, tocPagesList, markTocCurrent }) {
  const { S } = ctx;
  const keep = scroller.scrollTop;
  const defs = buildBook(ctx);
  pages.replaceChildren();
  const mk = (title) => {
    const body = h('div', { class: 'bk-body' });
    const page = h('section', { class: 'bk-page', 'aria-label': title || 'Страница' }, body);
    pages.append(page);
    return { page, body };
  };
  const room = (p) => p.clientWidth * (210 / 148 - 0.18); // высота тела листа: ширина × 210/148 минус поля (7cqw сверху, 11cqw снизу)
  const over = (c) => c.body.getBoundingClientRect().height > room(c.page) + 1;
  for (const d of defs) {
    if (d.blocks) { for (const b of d.blocks) mk(b.dataset.title).body.append(b); continue; }
    let cur = mk();
    for (const b of d.flow) {
      cur.body.append(b);
      if (!over(cur) || cur.body.children.length < 2) continue;
      const prev = cur.body.children[cur.body.children.length - 2];
      const move = prev?.classList.contains('bk-h') && cur.body.children.length > 2 ? [prev, b] : [b];
      cur = mk(); cur.body.append(...move);
    }
  }
  const org = S.r.supplierOrg;
  const docLabel = S.template ? 'Образец паспорта' : heading(S.r);
  [...pages.children].forEach((p, i) => {
    p.append(h('div', { class: 'bk-pno' }, [org?.shortName || org?.name, docLabel, `стр. ${i + 1}/${pages.children.length}`].filter(Boolean).join(' · ')));
  });
  const tocPagesLive = [...pages.children];
  tocPagesList.replaceChildren(...tocPagesLive.map((p, i) => {
    const title = p.querySelector('.bk-h')?.textContent?.split('\n')[0] || p.querySelector('[data-title]')?.dataset.title || p.getAttribute('aria-label') || ('стр. ' + (i + 1));
    // C141: страницы с правками изделия/ручными — заметнее; «общие» — спокойнее
    const hot = !!p.querySelector('.k-src[data-src="product"], .k-src[data-src="manual"], .bk-edit');
    return button({
      type: 'button',
      kind: 'ghost',
      size: 'S',
      cls: 'bk-toc-i' + (hot ? ' is-hot' : ' is-calm'),
      title,
      onClick: () => {
        markTocCurrent(i);
        p.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      label: [
        h('span', { class: 'bk-toc-n', 'aria-hidden': 'true' }, String(i + 1)),
        h('span', { class: 'bk-toc-t' }, title),
      ],
    });
  }));
  scroller.scrollTop = keep;
  return tocPagesLive;
}
