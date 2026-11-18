# ТЗ C146 — категории модулей в справочниках

**Зачем (словами пользователя):** «не нашёл где добавлять категории модулям».
**Зачем — глаголом:** менеджер заводит категорию модуля в «Справочниках» за 2 касания и сразу выбирает её при создании модуля.

## Глубже
- **Результат:** на проде есть живые `categories` с `type=module`; форма модуля и воронка состава перестают писать «нет категорий».
- **Сырьё:** сейчас UI создаёт только `type=material` («Категории») и `type=product` (разделы/группы). Подсказки в `modules.js` / `book-composition-funnel.js` отсылают в справочники, но списка `module` нет. API уже принимает `type=module` (`category.schema.ts`).
- **Метод:** зеркало справочника «Категории» склада, но `type: 'module'`, usage по `productmodules`.
- **Судья:** `GET /api/dicts/moduleCategories` → items; создать запись; `GET /api/categories?type=module` видит её; форма `#modules` показывает категорию в select.
- **Планка:** 0 ложных подсказок «заведите в справочниках» без пути; 1 новый dict-ключ.

**Класс:** M · **Max agents:** 1 · **Reviewers:** qa ☐ · **Max review loops:** 1 · **Проверки:** smoke  
**Язык менеджера:** да · **Приёмка:** `#dicts` → «Категории модулей» → «+» → имя → сохранить; `#modules` → «+» → категория в списке.

## Shared pack
- Решение: отдельная роль/коллекция не нужна — те же `categories`, фильтр `type=module`.
- Контракт: существующие `GET/POST /api/dicts/:key`, key=`moduleCategories`; создание пишет `type:'module'` + свободные `slug`/`skuPrefix` (как у material).

## Что сделать
1. Добавить dict `moduleCategories` в `dicts.defs.ts` (рядом с `categories`): group «Продукция» или рядом с группами изделий; title «Категории модулей»; hint «Зачем: выбрать при создании модуля/сборки. Пример: Каркас, Ограждение».
2. `DICT_META` + `DICT_UI.newTitle` = «Новая категория модуля».
3. `match: { type: 'module', deletedAt: null }`; `toDoc` на create — `type:'module'`, slug/skuPrefix как у material categories.
4. `usage` / `related` / `reassign` — по коллекции `productmodules` (`categoryId`).
5. Подсказки: `modules.js` и `book-composition-funnel.js` — явная ссылка «Справочники → Категории модулей» (`#dicts?d=moduleCategories`), не общее «в справочниках».
6. Atlas/help при необходимости одна строка (блок dicts или modules).
7. Юнит: toDoc создаёт `type:'module'`; meta sections/refBy есть (тест списка DICTS).

## Вид
- Только существующий экран справочников (list + правая панель). Новый kit не нужен.
- Заголовок и пустое состояние словами менеджера.

## Файлы
- Читать: `dicts.defs.ts` ~411–457 (categories); `dicts.meta.ts`; `DICT_UI` в defs ~914; `modules.js` ~29–31,154; `book-composition-funnel.js` ~311–327; `category.schema.ts` enum type.
- Менять: `backend/src/modules/dicts/dicts.defs.ts`, `dicts.meta.ts`, при нужде spec; `backend/pwa/sections/modules.js`; `backend/pwa/sections/passports/book-composition-funnel.js`; при нужде `atlas-data.js` / `help-guide-data.js`.
- Не читать: DESIGN/CANON/HISTORY целиком, openapi целиком.
- Нельзя: менять схему CRM `categories` enum (уже есть module); данные прода; другие типы категорий.

## Критерии приёмки
- [x] В меню справочников виден пункт «Категории модулей» (проверено в браузере на стенде).
- [x] Создание формирует документ с `type: 'module'` (юнит и создание «ТЕСТ-ИИ C146» через интерфейс стенда).
- [x] `GET /categories?type=module` и select в `#modules` видят запись (тот же id, тип module).
- [x] Подсказки содержат ссылки на `#dicts?d=moduleCategories` (проверено по исходникам).
- [x] smoke: `npx tsc --noEmit`; jest затронутых dicts; `node --input-type=module --check < modules.js` и funnel.

Точка продолжения: C146 принят на тестовом стенде под отдельной тестовой учёткой администратора. Для ограниченной роли недоступная кнопка скрыта, выведено «Только просмотр». Выпуск ещё не завершён. Подробности — в REPORT.md.

## Дополнения владельца к выпуску
- [x] Правило Inventor: константы внутри класса, явное сообщение о локальном сохранении без загрузки.
- [x] Категория детали в форме раздела и в книжке, сохранение старого выбора при редактировании.
- [x] Приёмка нижнего края доски заявок в обеих темах, дизайнер PASS (1920 × 1080).
- [ ] Итоговые проверки, коммит, push, штатный deploy и проверка версии/health.

## Нельзя
- Путать с «Категории» склада (`type=material`) и группами изделий (`type=product`).
- `git add -A`; чужие незакоммиченные файлы.

## Отчёт
`REPORT.md` в этой папке ≤ 40 строк; в чат — статус и путь.
