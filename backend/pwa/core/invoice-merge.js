/** T25: GET-предпросмотр не содержит строк — читаем их отдельными GET, API не меняем. */
const activeLines = (inv) => (inv.requests || []).filter((x) => !x.deletedAt && x.status !== 'cancelled');
const sum = (lines) => Math.round(lines.reduce((n, x) => n + (Number(x.priceHint) || 0), 0) * 100) / 100;
const equalAmount = (a, b) => Number.isFinite(Number(a)) && Math.abs(Number(a) - b) < 0.009;
// Точное правило supply-invoice.service.sameLine: материал (иначе название), количество, сумма всей строки.
export function sameInvoiceLine(a, b) {
  const title = (x) => String(x.title ?? x.materialName ?? '');
  const sameName = a.materialId && b.materialId ? String(a.materialId) === String(b.materialId) : title(a) === title(b);
  return sameName && Number(a.qty) === Number(b.qty) && Number(a.priceHint) === Number(b.priceHint);
}

export async function loadInvoiceMerge(request, sourceId, targetId) {
  const [preview, source, target] = await Promise.all([
    request(`/supply/invoices/${sourceId}/merge-preview`, { query: { targetId } }),
    request(`/supply/invoices/${sourceId}`),
    request(`/supply/invoices/${targetId}`),
  ]);
  const a = activeLines(source), b = activeLines(target);
  const skipped = a.filter((x) => b.some((y) => sameInvoiceLine(x, y)));
  // Между GET данные могли измениться; частичные/несогласованные строки нельзя выдавать за точный preview.
  if (source.partial || target.partial || String(source.id) !== String(sourceId) || String(target.id) !== String(targetId)
    || String(preview?.source?.id) !== String(sourceId) || String(preview?.target?.id) !== String(targetId)
    || source.status !== preview.source.status || target.status !== preview.target.status
    || a.length !== preview.source.lines || b.length !== preview.target.lines || skipped.length !== preview.duplicates
    || !equalAmount(preview.source.amount, sum(a)) || !equalAmount(preview.target.amount, sum(b))
    || !equalAmount(preview.resultAmount?.append, sum([...a, ...b]))
    || !equalAmount(preview.resultAmount?.mergeSameRequest, sum([...a.filter((x) => !skipped.includes(x)), ...b]))
    || !equalAmount(preview.resultAmount?.replaceLines, sum(a))) {
    throw new Error('Данные счетов изменились или доступны не все строки. Обновите предпросмотр.');
  }
  const plans = {
    append: { moved: a, skipped: [], replaced: [] },
    mergeSameRequest: { moved: a.filter((x) => !skipped.includes(x)), skipped, replaced: [] },
    replaceLines: { moved: a, skipped: [], replaced: b },
  };
  return { ...preview, source: { ...source, ...preview.source }, target: { ...target, ...preview.target }, plans };
}

/** retry только перечитывает GET. После любой ошибки POST пользователь заново видит и подтверждает preview. */
export async function mergeInvoiceWithPreview(request, sourceId, targetId, { confirm, retry }) {
  for (;;) {
    let preview;
    try { preview = await loadInvoiceMerge(request, sourceId, targetId); }
    catch (e) { if (await retry(e, false)) continue; return null; }
    const strategy = await confirm(preview);
    if (!strategy) return null;
    if (!preview.strategies.includes(strategy) || !preview.plans[strategy]) throw new Error('Выберите способ объединения');
    try {
      return await request(`/supply/invoices/${sourceId}/merge`, { method: 'POST', noWait: true, body: { targetId, strategy } });
    } catch (e) { if (!(await retry(e, true))) return null; }
  }
}
