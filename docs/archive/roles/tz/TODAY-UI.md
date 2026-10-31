# ТЗ TODAY-UI — «Сегодня» по ролям (фронт)

**Класс:** L · исполнитель frontend · затем designer · **Проверки:** `node --input-type=module --check < файл`.
Источник и план: `docs/audit/AUDIT-TODAY.md` целиком (65 строк) — §3 структура по ролям, §4 п. 5–15 — делай по ним.

## Контракт сервера (делается параллельно)
- В ленте `/api/today` появится `kind:'work'` (`{kind,id,title,sub,due,actions:[],personId?}`), подпись «В работе», клик → `go('work', { open: id })`. `metrics.work` — число заданий в работе. Пока сервер не выложен — вид просто не приходит; код должен это переживать.
- Группы «Требуют заполнения» про счета: ключи `exp-noinvoice`, `exp-paid`, `exp-amount`, `exp-date` (см. `backend/src/modules/fill-audit/fill-audit.service.ts`). `fillToday()` из `sections/fill.js` — подключить для accountant/director/admin (п. 12), можно передать фильтр групп, если нужно, — но fill.js не менять (его недавно правил координатор); фильтруй в home.js или используй как есть.

## Файлы
- Менять: `backend/pwa/sections/home.js`, `backend/pwa/sections/help-flow-data.js` (помощь «?» — шаг «Сегодня» по новой структуре), CSS — новые классы `.td-weekfold`, `.td-passports` (в том файле, где живут `.td-*`).
- Параллельно другой исполнитель правит: `sections/orders.js`, `sections/money.js`, `sections/salesorders.js`, `main.js`, `ui/op-row.js` — **не трогать**. Если нужна правка там — напиши в отчёте.
- Не читать: CANON/HISTORY/TASKS целиком.

## Приёмка
- [ ] Каждая роль видит свои 3–5 блоков по §3; колокольчик убран из «Сегодня»; одно пустое состояние.
- [ ] 390 / 1024 / 1920 без горизонтальной прокрутки; кнопки ≥ 44 px на телефоне.
- [ ] syntax check 0.
Не коммитить. Отчёт ≤ 12 строк.
