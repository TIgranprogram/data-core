# ТЗ: правые панели, волна 3 (ПМ-1) — заказ, паспорт, договоры, КП, каталог, проектирование, работа, сотрудник

- Класс: L. Исполнитель: `datacore-frontend` (1). После — приёмка `datacore-designer`. Не коммитить.
- Правила и образцы — как в `docs/roles/tz/RIGHT-PANEL-WAVE2-2026-11-06.md` (п. 1–6) + цвет категории: `section({ title, count, tone, body })`.
  Цвета (одна категория — везде один): производство (проектирование, работа, маршрут) `main` · файлы, фото, чертежи `info` · деньги, оплаты, заказы, цены `money` · заявки, вложения, исполнители и связи с людьми `who` · склад, брони, выдачи `gold` · документы, паспорта, бланки, тексты `neutral`.
- `ui/kit/*` не менять (нужен новый эталон — стоп, вопрос координатору).

## Scope (только эти файлы)
1. Заказ / договор: `sections/salesorders.js:134,201,214,242–351,492–548` — вкладки (`kitTabs`) оставить; блоки внутри вкладок `sec()` на `.section-title` → `section()`; кнопки шапки договора — через `actions()` (зазор 8 px, не `so-grp-acts` с 4 px, если можно без нового класса — иначе оставить и записать в отчёт).
2. Паспорт: `sections/passports.js:128–182` (кнопки: видимыми «Выпустить» и «⇩ PDF и печать», остальное `more: true`), `passports/card-blocks.js:17–118` (секции; «Проверка» открыта, если чего-то не хватает).
3. Договоры поставщика: `sections/contracts.js` `contractsBlock` (заголовок «Договоры» → `section`, tone `money`).
4. КП: `sections/offers.js:233–250`, `kp.js:232` — «Похожие», «Изделия» → `section`.
5. Каталог поставщиков: `sections/supplier-catalog.js:347–395` — «История цен» → `section` (tone `money`).
6. Проектирование: `sections/design.js:250–260`, `design-order.js`, `design-requests.js:121–133`, `design-side.js` — самодельные `db-blk` (`details` + `summary.section-title`) в правой панели → `section()` (tone `main`). Доску и левую колонку не трогать.
7. Работа: `sections/work.js:152,182,234–280` — «Маршрут», «Исполнитель и примечание» → `section`.
8. Сотрудник: `sections/staff.js:128–242` — `.st-block` + `h3.section-title` → `section()` (tone `who`), действия блока внутри секции.

## Не читать
`backend/src`, `docs/archive`, `ui/kit/*` (только импорт), мобильный склад (`stock-mobile.js`, `warehouse-mobile.js`).

## Проверки (сам)
- `node --input-type=module --check < файл` для каждого изменённого.
- `node backend/scripts/design-lint.mjs` — «новых 0»; файлы > 400 строк не должны расти (L8).
- `node --experimental-vm-modules --test backend/pwa/sections/*.test.mjs` — зелёные (моки kit дополнить `stack`/`section`, если падают).
- `grep -n "section-title"` в правых панелях изменённых файлов — 0.

## Отчёт (≤ 15 строк)
По каждой панели: что стало секциями (с цветом), какие кнопки ушли в «⋯», файл:строки; что не сделано и почему.
