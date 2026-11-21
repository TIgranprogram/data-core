import { normSearch } from '../../core/facets.js';

const ALIASES = {
  requests: ['заявка', 'заявки на закупку', 'заявка поставщику'],
  products: ['изделия', 'каталог изделий'],
  'area:system': ['система', 'системные сервисы'],
  needs: ['что купить', 'чего не хватает'],
};
const KIND_ORDER = { section: 0, area: 1, part: 2, action: 3 };

export function atlasSearchIndex(data) {
  const wiring = new Map();
  for (const { from, to, label } of data.edges) {
    if (!label) continue;
    for (const id of [from, to]) {
      if (!wiring.has(id)) wiring.set(id, new Set());
      wiring.get(id).add(label);
    }
  }
  return [...data.nodes.values()].map(node => {
    const titles = [node.title, ...(ALIASES[node.id] || [])].map(normSearch);
    const trail = data.chain(node.id).slice(0, -1).map(id => data.nodes.get(id).title).join(' → ');
    const path = normSearch(node.title + ' ' + trail);
    const body = normSearch([path, node.description, node.where, ...(wiring.get(node.id) || [])].join(' '));
    return { node, trail, titles, path, body };
  });
}

export function findAtlasNodes(index, raw) {
  const query = normSearch(raw);
  if (!query) return [];
  const words = query.split(' ');
  const rank = (texts, prefix, miss) => {
    if (texts.some(title => title === query)) return 0;
    if (texts.some(title => title.startsWith(query))) return prefix;
    if (texts.some(title => words.every(word => title.includes(word)))) return prefix + 1;
    return miss;
  };
  return index.flatMap(entry => {
    const score = Math.min(rank(entry.titles, 2, Infinity),
      words.every(word => entry.path.includes(word)) ? 4 : Infinity,
      words.every(word => entry.body.includes(word)) ? 5 : Infinity);
    return Number.isFinite(score) ? [{ entry, score }] : [];
  }).sort((a, b) =>
    a.score - b.score ||
    Number(a.entry.node.planned) - Number(b.entry.node.planned) ||
    KIND_ORDER[a.entry.node.kind] - KIND_ORDER[b.entry.node.kind] ||
    a.entry.node.title.localeCompare(b.entry.node.title, 'ru'))
    .slice(0, 8).map(({ entry }) => entry);
}
