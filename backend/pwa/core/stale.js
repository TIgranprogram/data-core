/** Ошибка «старая копия приложения рядом с новой» (Р6, C112). Чистая логика без DOM — проверяется node:test.
 *  Признаки: модуль не загрузился (файл переехал) или новый модуль просит имя, которого нет в старом
 *  («The requested module './common.js' does not provide an export named …», ошибка 13.11), или наш текст «Приложение обновилось». */
export const STALE = /dynamically imported module|Importing a module script failed|error loading dynamically|does not provide an export named|Приложение обновилось/i;
export const isStale = (e) => STALE.test(String(e?.message || e || ''));

/** Можно ли перезагрузить сейчас: не чаще раза в 2 минуты (иначе вечный цикл, если сервер сам отдаёт битую пару). */
export const RELOAD_GAP = 120000;
export const mayReload = (lastAt, now = Date.now()) => !(Number(lastAt) > 0) || now - Number(lastAt) > RELOAD_GAP;
