# ЗЯ-1c — отчёт frontend (2026-11-05, не закоммичено)
Статус: готово (кроме мест без серверного обхода). Проверки: syntax ok x5, pwa-import-check 0 ошибок, design-lint 0, pwa-guards 207 зелёных. invoice-workspace.test.mjs локально не идёт (нужен флаг vm-modules, не из-за правки).
- Новый `sections/admin-override.js`: dry-run → окно (предупреждения; при canProceed:false — только причины отказа, без кнопки) → {confirm:true, reason ≥3}; `withReason` для PATCH/POST, где сервер просит причину. Окно — kit `modal`.
- `requests.js`: «Отменить приёмку» (меню «Ещё», admin, статус «Получено»); PATCH заявки шлёт reason при запросе сервера.
- `invoice-workspace-state.js` (+unpay, rollback), `invoice-workspace.js`: «Снять оплату» (оплаченный счёт без приёмки), «Отменить приёмку» в строке принятой позиции; колонка «Действия» учитывает rollback.
- `offers.js`: PATCH/status с reason; admin видит «Вернуть статус: …» и подсказку про оплаченное КП.
- Не менял orders/salesorders/order-line-actions/request-step: серверных обходов для них в 1a/1b нет (п.16, 20 и так admin).
- Help «?» не менял: путей и слов меню нет. `index.html` обновлён pwa-preload (+admin-override.js).
Глазами (admin): оплаченный счёт → «Снять оплату» → окно с причиной; принятая строка → «Отменить приёмку»; заявка «Получено» → Ещё → «Отменить приёмку»; оплаченное КП → Ещё → «Вернуть статус…», правка → запрос причины. Не-admin: кнопок нет.
Риск: withReason ловит 400 по слову «причин» в тексте сервера.

## Правки по приёмке дизайнера
- `core/api.js` (errorOf, +1 строка): `e.data.code='REASON_REQUIRED'` не прокидывался — добавил (иначе withReason не сработал бы).
- `admin-override.js`: повтор по `e.data?.code`; отмена причины → `null` без тоста. offers.js (status — return; update — вернёт текущую КП), requests.js (update — перечитывает заявку) трактуют null как отмену.
- Кнопки в счёте «Снять оплату» / «Отменить приёмку» — kit `danger`; пункт меню заявки — меню, без вида.
- Отказ (blockers) — жирная строка + обычный список, не hint.
- 390 px: `.modal` width min(560px,100%), overflow-x hidden; `.field textarea` width 100% — не вылезает.
