/** Движение склада в минимальном виде для подсчёта «выдано под позицию заказа». */
export interface IssuedMove {
  type: string;
  qty: number;
  materialId: unknown;
  salesOrderLineId?: unknown;
  isReturn?: boolean;
  cancelledAt?: unknown;
  cancelOf?: unknown;
}

export interface IssuedNet { salesOrderLineId: string; materialId: string; issued: number; returned: number; net: number }

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * «Выдано под позицию заказа» (SK-5): нетто по паре позиция заказа × материал = Σ выдач − Σ возвратов.
 * Выдача — `out` с позицией; возврат — `in` с `isReturn` и позицией. Отменённые (`cancelledAt`) и сами записи-отмены (`cancelOf`) не считаются.
 */
export function netIssuedByLine(moves: IssuedMove[]): IssuedNet[] {
  const map = new Map<string, IssuedNet>();
  for (const m of moves) {
    if (!m.salesOrderLineId || m.cancelledAt || m.cancelOf) continue;
    const out = m.type === 'out', back = m.type === 'in' && m.isReturn === true;
    if (!out && !back) continue;
    const key = `${String(m.salesOrderLineId)}|${String(m.materialId)}`;
    const row = map.get(key) ?? { salesOrderLineId: String(m.salesOrderLineId), materialId: String(m.materialId), issued: 0, returned: 0, net: 0 };
    if (out) row.issued += Number(m.qty) || 0; else row.returned += Number(m.qty) || 0;
    map.set(key, row);
  }
  return [...map.values()].map((r) => ({ ...r, issued: r3(r.issued), returned: r3(r.returned), net: r3(r.issued - r.returned) }));
}
