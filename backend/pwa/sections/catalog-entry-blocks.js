import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { recentThumb } from '../core/recent-cards.js';
import { canFollow } from '../core/route-access.js';
import { busyBlock, button, carousel, clamp, failBlock, hint, link, posPic, section, table } from '../ui/kit/index.js';

const photoRef = (value) => typeof value === 'object' ? value?.id || value?._id : value;
function photoRefs(record) {
  const refs = new Map();
  for (const value of [record.mainPhotoId, ...(record.photoIds || [])].filter(Boolean)) {
    const id = photoRef(value) || value.storageUrl;
    if (id && (!refs.has(id) || typeof value === 'object')) refs.set(id, value);
  }
  return [...refs.values()];
}

function catalogPicture(record) {
  if (record?.mimeType && !record.mimeType.startsWith('image/')) return null;
  const url = recentThumb(record?.storageUrl).replace(/\/{2,}/g, '/').replace(/^\/db\//i, '/');
  if (!url || /^\/uploads\/(?:apps|attachments|pdm)\//i.test(url)) return null;
  return { url };
}

export const catalogPhotoColumn = {
  key: 'photo', label: 'Фото', cls: 'pic-cell', export: false,
  render: (record) => posPic(photoRefs(record).map(catalogPicture).find(Boolean), 'lg'),
};

async function readPictures(record) {
  const refs = photoRefs(record);
  const loaded = await Promise.allSettled(refs.map(async (ref) => {
    if (typeof ref === 'object') return catalogPicture(ref);
    if (!/^[a-f0-9]{24}$/i.test(ref)) return null;
    try {
      return catalogPicture(await api('/photos/' + ref));
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }));
  const pictures = loaded.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);
  const unique = new Map(pictures.map(picture => [picture.url, picture]));
  return { pictures: [...unique.values()], unavailable: loaded.some(result => result.status === 'rejected') };
}

export function catalogPhotoBlock(record) {
  const host = h('div', null, busyBlock('фото'));
  const paint = (pictures, unavailable = false) => {
    if (!pictures.length) {
      host.replaceChildren(hint(unavailable ? 'Фото недоступно' : 'Нет фото'));
      return;
    }
    const view = carousel(pictures).el;
    const cover = view.querySelector('.pgal-img');
    cover.addEventListener('error', () => {
      const failed = new URL(cover.src).pathname;
      paint(pictures.filter(({ url }) => !failed.endsWith(url)), true);
    }, { once: true });
    host.replaceChildren(view);
  };
  readPictures(record).then(({ pictures, unavailable }) => paint(pictures, unavailable));
  return section({ title: 'Фото', open: true, body: host });
}

const parents = {
  product: { route: 'products', label: 'Изделие' },
  module: { route: 'modules', label: 'Модуль' },
};

export function catalogWhereUsed(base, id) {
  const host = h('div');
  const more = button({ label: 'Показать ещё', size: 'S', onClick: () => load() });
  const rows = [];
  let nextPage = 1;
  let hasMore = true;
  const columns = [
    { label: 'Входит в' }, { label: 'Название' },
    { label: 'Количество на 1 шт.', num: true, nowrap: true },
  ];
  const url = base + '/' + encodeURIComponent(id) + '/where-used';
  function present(item) {
    const target = Object.hasOwn(parents, item.kind) && parents[item.kind];
    if (!target || !item.id) return null;
    const href = '#' + target.route + '?open=' + encodeURIComponent(item.id);
    if (!canFollow(session, href)) return null;
    const amount = item.quantity == null ? '—' : [qty(item.quantity), item.unit].filter(Boolean).join(' ');
    return { cells: [target.label, link({ label: clamp(item.name, { lines: 2 }), title: item.name, href }), amount] };
  }
  async function load() {
    more.disabled = true;
    const progress = busyBlock('связи');
    host.append(progress);
    try {
      do {
        const page = await api(url, { query: { page: nextPage, limit: 20 } });
        const visible = page.items.map(present).filter(Boolean);
        rows.push(...visible);
        hasMore = page.items.length > 0 && page.page * page.limit < page.total;
        nextPage++;
        if (visible.length) break;
      } while (hasMore);
      host.replaceChildren(table({
        columns, rows, label: 'Где используется',
        empty: { title: 'В доступном составе вхождений нет' },
      }), ...(hasMore ? [more] : []));
    } catch (error) {
      host.replaceChildren(failBlock(error, load, { text: 'Связи не загрузились' }));
    } finally {
      progress.remove();
      more.disabled = false;
    }
  }
  load();
  return section({ title: 'Где используется', open: true, body: host });
}

