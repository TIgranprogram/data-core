# C114 B — фирма из заказа (frontend)

- `passports/common.js`: `firmFor(salesOrderId)` (фирма заказа `companyId` → единственная → последняя использованная, ключ `dc-passport-firm-<uid>` общий с воронкой), `lastFirm/rememberFirm`.
- `passports/form.js`: `initial` берёт фирму через `firmFor`; при выпуске `rememberFirm`; подсказка поля «Фирма» дополнена («Номер от выбора фирмы не меняется»).
- `passports/wire-form.js`: под полем «Фирма» подсказка «Заказ на <А>. Выпустить на другую фирму — выберите здесь, номер не изменится.» (если фирма из заказа); в плашке «Осталось сделать» «Поставщик» → «Фирма» (сервер отдаёт label «Поставщик» с key supplierOrgId — `passport-rules.ts:145`; переименовано на экране).
- `passports/funnel/issue.js`: та же подсказка в воронке (фирма и так бралась из `orderDoc.companyId`).
- Чипы «Осталось сделать»: с key — кнопка `goTo(key)` (скролл + фокус + подсветка), `supplierOrgId` есть в форме — работает; без key — серый текст (так отдаёт сервер). В воронке «Не хватает» — ссылки `goGaps`.
- `order-passport-plan.js` не менялся (фирма заказа там уже показана и выбирается блоком `firmBlock`).
- Проверки: `--check` 4 файлов ok; pwa-guards 299/299; design-lint новых 0. Снимков нет (стенд не запускался).
- Нужно от backend (желательно): в `passport-rules.ts:145` label 'Поставщик' → 'Фирма' (тогда убрать подмену в wire-form; spec `passport-check-product.spec.ts:30,32`, `passport-rules.spec.ts:96` ждут 'Поставщик').
