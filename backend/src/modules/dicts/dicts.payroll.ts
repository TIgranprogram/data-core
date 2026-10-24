/**
 * SK-8d: справочник «Сотрудники» нужен всем разделам («Кто подал», «Кому выдано»), но оплата
 * (salaryKind / salaryRate) — данные раздела «ФОТ». Закрыт ФОТ — убираем эти поля из строк
 * и из описания формы (fields), чтобы их не было ни в ответе, ни в форме.
 */
const PAYROLL_KEYS = ['salaryKind', 'salaryRate'];

type Row = Record<string, unknown>;

const stripRow = (r: Row): Row => Object.fromEntries(Object.entries(r).filter(([k]) => !PAYROLL_KEYS.includes(k)));
const stripFields = (info: unknown) => {
  if (!info || typeof info !== 'object' || !Array.isArray((info as Row).fields)) return info;
  return { ...(info as Row), fields: ((info as Row).fields as Row[]).filter((f) => !PAYROLL_KEYS.includes(String(f.key))) };
};

/** Ответ list (`{items, dict}`) или карточки (`{…строка, dictInfo}`) справочника persons без оплаты. */
export function hidePayroll<T>(res: T): T {
  if (!res || typeof res !== 'object') return res;
  const r = res as Row;
  if (Array.isArray(r.items)) return { ...r, items: (r.items as Row[]).map(stripRow), dict: stripFields(r.dict) } as T;
  const out = stripRow(r);
  if ('dictInfo' in r) out.dictInfo = stripFields(r.dictInfo);
  return out as T;
}
