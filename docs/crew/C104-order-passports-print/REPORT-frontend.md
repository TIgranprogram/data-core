# C104 frontend — отчёт
Статус: код готов, design-lint не 0 (нужен вариант kit); снимков на :3102 нет.
- Новый `backend/pwa/sections/passports/print-options.js`: `printOptions` (плитки формата + Печать/Подпись + ч/б), `printQuery` (variant, stamp/seal=0/sign=0, mode, bw, ids), `ORDER_FORMATS` (без стенда).
- `passports/dialogs.js` `printDialog` переведён на модуль (поведение то же); `FORMATS` вынесен в модуль.
- `order-passport-plan.js` `printOrderDialog`: кнопка «Печать…»; список выпущенных паспортов галочками (kit.guide.toggle), «Отметить все / Снять все», формат/печать/подпись/ч-б; ids передаётся только если отмечены не все. Ничего не отмечено — кнопка неактивна и ошибка.
- Тест: `passports/print-options.test.mjs` 3/3. --check ок, pwa-preload (155), pwa-guards 292/293 (падает только design-lint).
- Риск 1: design-lint 6 находок в print-options.js (R2 ui/icons, L2 button плитки, L3 pf/pf-opt/pf-opts/pf-checks) — это перенесённый код dialogs.js, эталона плиток формата в kit нет. Нужен вариант kit «плитки выбора формата» (или baseline-принятие пользователем).
- Риск 2: в плане заказа у `row.firm` нет hasSeal/hasSignature — по умолчанию обе галочки включены; хорошо бы сервер отдавал флаги.
- Риск 3: X-Skipped-Passports клиент не читает (как и раньше); остаётся блок ссылок на файлы под кнопками.
