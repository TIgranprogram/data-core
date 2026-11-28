import { loadFinancialArticles, articleChoices, flattenArticles, categoryArticleCandidates } from './financial-articles.js';
import { h } from '../core/dom.js';

/** C161: внутренний выбор использует каноническое рекурсивное дерево, включая историю. */
export const articleTree = (refresh = false) => loadFinancialArticles({ type: 'expense', includeArchived: true, refresh }).then(data => data.items || []);
export const articleOptions = (tree, empty, savedId) => articleChoices(tree, empty, { type: 'expense', savedId });
export const articleFilterOptions = tree => [{ value: 'none', label: 'Без статьи' }, ...flattenArticles(tree).filter(row => row.type === 'expense').map(row => ({ value: row.id, label: row.path.join(' → ') + (row.archivedAt ? ' · архивная' : '') }))];
export const articleByCategory = (tree, categoryId) => { const choices = categoryArticleCandidates(tree, categoryId); return choices.length === 1 ? choices[0].id : ''; };

export const requestArticleField = (tree, lk, r, linked) => ({
  key: 'articleId', money: true, label: 'Статья расхода', type: 'select', options: articleOptions(tree, 'Не указана', r?.articleId), wide: true, hint: 'Подставляется по категории — можно сменить. Нужна для «Денег → По статьям»',
  mount: (fapi) => {
    const warning = h('p', { class: 'hint', hidden: true }); fapi.field('articleId')?.append(warning);
    const sync = () => {
      if (fapi.manual('articleId') || (fapi.get('articleId') && !fapi.input('articleId').classList.contains('is-default'))) return; // выбрано вручную или сохранено раньше
      const cat = lk.categories.find((c) => c.name === (linked ? r.categoryName : fapi.get('categoryName')));
      const candidates = cat ? categoryArticleCandidates(tree, cat.id) : []; warning.hidden = candidates.length < 2; warning.textContent = candidates.length > 1 ? 'Для категории есть несколько статей. Выберите подходящую по первичке.' : '';
      const id = candidates.length === 1 ? candidates[0].id : '';
      if (id) fapi.set('articleId', id, { auto: true, src: 'по категории' });
    };
    fapi.on('categoryName', sync); sync();
  },
});
