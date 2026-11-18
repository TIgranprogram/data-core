/** Принятие предложения состава: новые источники добавляются, существующие строки остаются ручным решением. */
const clone = (value) => JSON.parse(JSON.stringify(value));
const refs = (row) => Array.isArray(row?.sourceRefs) ? row.sourceRefs : [];
export const sourceRefKey = (ref) => JSON.stringify([
  ref.kind, String(ref.refId || ''),
  ...(ref.path || []).map((p) => [p.kind, String(p.refId || ''), String(p.lineId || '')]),
]);
const fields = ['materialId', 'sizes', 'partIds', 'passportText', 'techText'];
const valueOf = (row, field) => ['sizes', 'partIds'].includes(field)
  ? [...(row[field] || [])].map(String).sort() : String(row[field] || '');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rowKey = (row) => JSON.stringify(fields.map((field) => valueOf(row, field)));
const specOf = (value) => ({ rows: clone(value?.rows || []), coatingIds: [...(value?.coatingIds || [])], coatingTexts: clone(value?.coatingTexts || []) });

export function planMaterialsProposal(current, proposal, extraSources = []) {
  const next = specOf(current);
  const incoming = specOf(proposal);
  const reports = [];
  let added = 0;
  const known = new Set([...incoming.rows.flatMap(refs), ...extraSources].map(sourceRefKey));
  const bySource = new Map();
  const manual = new Set(next.rows.filter((r) => !refs(r).length).map(rowKey));
  next.rows.forEach((row, index) => {
    for (const ref of refs(row)) {
      const key = sourceRefKey(ref);
      if (!bySource.has(key)) bySource.set(key, []);
      bySource.get(key).push(index);
    }
    const missing = refs(row).filter((ref) => !known.has(sourceRefKey(ref)));
    if (missing.length) reports.push({ rowIndex: index, missing: true, sources: clone(missing), changes: [] });
  });
  for (const row of incoming.rows) {
    const sourceRefs = refs(row);
    if (!sourceRefs.length) {
      const key = rowKey(row);
      if (!manual.has(key)) { next.rows.push(clone(row)); manual.add(key); added += 1; }
      continue;
    }
    const matches = new Set(sourceRefs.flatMap((ref) => bySource.get(sourceRefKey(ref)) || []));
    for (const index of matches) {
      const existing = next.rows[index];
      const changes = fields.filter((field) => !equal(valueOf(existing, field), valueOf(row, field)))
        .map((field) => ({ field, before: clone(valueOf(existing, field)), after: clone(valueOf(row, field)) }));
      if (changes.length) reports.push({ rowIndex: index, changes, sources: clone(sourceRefs), missing: false });
      const fresh = new Map(sourceRefs.map((ref) => [sourceRefKey(ref), ref]));
      existing.sourceRefs = refs(existing).map((ref) => clone(fresh.get(sourceRefKey(ref)) || ref));
    }
    const uncovered = sourceRefs.filter((ref) => !bySource.has(sourceRefKey(ref)));
    if (uncovered.length) {
      const index = next.rows.length;
      next.rows.push({ ...clone(row), sourceRefs: clone(uncovered) });
      for (const ref of uncovered) bySource.set(sourceRefKey(ref), [index]);
      added += 1;
    }
  }
  next.coatingIds = [...new Set([...next.coatingIds, ...incoming.coatingIds])];
  const ownTextIds = new Set(next.coatingTexts.map((t) => t.materialId));
  const coatingKeys = new Set(next.coatingTexts.map((t) => JSON.stringify(t)));
  for (const text of incoming.coatingTexts) {
    const key = JSON.stringify(text);
    if (!ownTextIds.has(text.materialId) && !coatingKeys.has(key)) {
      next.coatingTexts.push(clone(text)); coatingKeys.add(key);
    }
  }
  return { spec: next, added, reports };
}
