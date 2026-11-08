/**
 * SK-8d: справочник «Сотрудники» нужен всем разделам («Кто подал», «Кому выдано»), но оплата
 * (salaryKind / salaryRate) — данные раздела «ФОТ». Закрыт ФОТ — убираем эти поля из строк
 * и из описания формы (fields), чтобы их не было ни в ответе, ни в форме.
 * C050: так же прячем «Вход в приложение» (кроме администратора и директора) и контакты — у роли только с «Мои задания».
 */
const PAYROLL_KEYS = ['salaryKind', 'salaryRate'];
/** Вход сотрудника: поле, подпись и список входов (`refs.users`). */
const LOGIN_KEYS = ['userId', 'userName'];
/** Контакты сотрудника, которые рабочему с одним разделом «Мои задания» не нужны. */
export const CONTACT_KEYS = ['phone', 'email', 'birthDate', 'notes'];

type Row = Record<string, unknown>;

const stripRow = (keys: string[]) => (r: Row): Row => Object.fromEntries(Object.entries(r).filter(([k]) => !keys.includes(k)));
const stripFields = (keys: string[]) => (info: unknown) => {
  if (!info || typeof info !== 'object' || !Array.isArray((info as Row).fields)) return info;
  const rest = Object.fromEntries(Object.entries(info as Row).filter(([k]) => k !== 'refs' || !keys.includes('userId')));
  const refs = (info as Row).refs && typeof (info as Row).refs === 'object' ? Object.fromEntries(Object.entries((info as Row).refs as Row).filter(([k]) => !(keys.includes('userId') && k === 'users'))) : undefined;
  return { ...rest, ...(refs ? { refs } : {}), fields: ((info as Row).fields as Row[]).filter((f) => !keys.includes(String(f.key))) };
};

/** Ответ list (`{items, dict}`) или карточки (`{…строка, dictInfo}`) справочника persons без указанных полей. */
export function hideKeys<T>(res: T, keys: string[]): T {
  if (!res || typeof res !== 'object') return res;
  const r = res as Row;
  const row = stripRow(keys), info = stripFields(keys);
  if (Array.isArray(r.items)) return { ...r, items: (r.items as Row[]).map(row), dict: info(r.dict) } as T;
  const out = row(r);
  if ('dictInfo' in r) out.dictInfo = info(r.dictInfo);
  return out as T;
}

/** Ответ справочника persons без оплаты. */
export const hidePayroll = <T>(res: T): T => hideKeys(res, PAYROLL_KEYS);
/** Ответ справочника persons без «Входа в приложение». */
export const hideLogin = <T>(res: T): T => hideKeys(res, LOGIN_KEYS);
/** Ответ справочника persons без телефонов, почты и примечаний. */
export const hideContacts = <T>(res: T): T => hideKeys(res, CONTACT_KEYS);
