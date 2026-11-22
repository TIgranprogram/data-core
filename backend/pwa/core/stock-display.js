const text = (v) => String(v ?? '').trim();

/** Импортированная карточка может хранить в имени обозначение PDM. Показываем готовый текст из её полей. */
export function stockPositionName(row) {
  const name = text(row.name);
  const codes = [row.article, row.pdmCode, row.sku].map(text).filter(Boolean);
  if (name && !codes.includes(name)) return name;
  const purchasedPdm = row.pdmCode && ['fastener', 'purchased'].includes(row.materialKind);
  const assortment = text(row.assortment);
  const titles = [text(row.fullName), text(row.invoiceName)];
  if (purchasedPdm && /[а-яё]{2,}|[a-z]{2,}\s/i.test(assortment)) titles.push(assortment);
  return titles.find((title) => title && !codes.includes(title)) || name;
}

export function stockPositionCode(row) {
  return row.supplierArticle || row.pdmCode || row.internalCode || '';
}
