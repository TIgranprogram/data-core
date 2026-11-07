# FIX-TZ — C018 аудит «Документация» (PWA)

**Класс:** S · **Max agents:** 0 · **Проверки:** smoke (syntax + pwa-import-check)

## Контекст
Аудит docs (C018): заглушки sec уже сняты в v1.498. Остаток — шум UI и мелкие баги панелей.

## Что сделать
1. `passarchive.list`: `headActions: () => []` — убрать полоску номеров (наследуется из `passports.list`).
2. «Дописать и выпустить» в архиве: `patch({ of: 'passports', open: row.id })` (`docs.js:215`).
3. Вкладка `templates`: подпись **«Шаблоны»** (не дублировать «Паспорта»); подсказки/крошки с «вкладка «Паспорта»» → «Шаблоны».
4. Шапочный комментарий `docs.js` — без sec=acts|waybills.
5. Очередь: «Открыть» → `passarchive` для выпущенного, `passports` для черновика (`passportState`).

## Файлы
- `backend/pwa/sections/docs.js`
- `backend/pwa/sections/docs-queue.js`
- `backend/pwa/sections/docs-orders.js` (легенда, если есть «Паспорта»)
- `backend/pwa/sections/help-flow-data.js` (строка про вкладки)

## Приёмка
- [ ] `#docs` — одна полоса вкладок, без strip в «Выпущенные»
- [ ] Черновик из архива открывает карточку с id
- [ ] `node --input-type=module --check` на изменённых js

## Нельзя
- Удалять lazy `passports`, менять API.
