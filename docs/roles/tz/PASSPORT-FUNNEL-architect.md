# ПВ — решение архитектора (2026-10-25, коммит 61b18c6)

Принцип: не зависеть от списка вопросов. Фиксируем форму данных и точки стыка; разделы и варианты — данные в справочнике.

## 1. Дерево текстов — в dict_values, справочник passportPhrases расширяем (новый справочник не нужен)
Узел = запись dict:passportPhrases. Новые необязательные поля (старые section, categories, text, name остаются):
- parentId (ObjectId узла или null). Корень (parentId null) = раздел паспорта: section = ключ раздела (purpose, installation, montage), name = заголовок вопроса. Дальше варианты и подварианты; лист = узел с text, у узла с детьми text пуст. Глубина не больше 4.
- categories (CSV кодов, как во всех справочниках паспортов — конвенцию не менять) + allCategories (bool, «Для всех»). Виден узел, если allCategories или код в categories; предок виден, если виден любой потомок.
- order (число среди соседей), required (bool, только корень: раздел обязателен), installTypeId (необязательно, у листа раздела установки: выбор варианта сам ставит installationTypeId паспорта — схемы, рисунки, требования к основанию остаются в passportInstall), slot (число, корень, по умолчанию 1: какой по номеру пункт раздела шаблона заменяет выбранный текст).
- Один вариант на шаге — клиент подставляет сам.
- Проверки в toDoc: родитель в том же dict, нет цикла, глубина, лист без детей, у узла с детьми нет текста. Удаление узла с детьми — отказ по-русски «сначала уберите варианты».
- dicts.defs.ts (passportPhrases): usage считает productpassports.textChoices.РАЗДЕЛ и products.passportDefaults.textChoices.РАЗДЕЛ по id узла (старое сравнение по тексту оставить); reassign (merge) через withProducts переписывает products.passportDefaults.textChoices.* и черновики паспортов, выпущенные не трогает.
- Индексы не нужны: справочник читается целиком одним запросом, индекс dict+deletedAt уже есть (ensure-indexes.js:20).

### Сборка текста (backend/src/modules/product-passport/)
Сейчас: «Для всех» (код + база ALL_V2 в passporttemplates) + версия категории, замена по номеру пункта (passport-v2-text.ts:buildV2Text, legacyTemplateToBlocks). Не ломаем: выбор воронки добавляется верхним слоем. buildV2Text получает choices и phrases, строит синтетический раздел (ключ = section, текст листа на позиции slot) и вливает его в own до legacyTemplateToBlocks. Выпущенные снимки и PDF v1 не затронуты. Переменные в тексте листа те же (name, std:КОД), compose их подставляет. Позже, отдельной задачей, passporttemplates по категориям можно вытеснить деревом целиком — сейчас не делать.

## 2. Изделие как источник
- Уже есть products.passportDefaults (showcase/passport-defaults.ts, PUT :id/passport-defaults). Добавить внутрь textChoices (объект: ключ раздела, значение ObjectId листа) — новое необязательное поле внутри существующего объекта; CRM не читает. normalizePassportDefaults сейчас отбрасывает неизвестные ключи — добавить textChoices (проверка: узел есть, лист, раздел совпадает).
- Паспорт: новое поле productpassports.textChoices (product-passport.schema.ts) и в DTO в dto/ — иначе 400 из-за forbidNonWhitelisted. «Выпустить паспорт от изделия» копирует passportDefaults, теперь и textChoices; purpose/installationMethod паспорта заполняются текстом выбранного листа (производное, для kppdf, PDF v1, описания).
- Клона изделия в showcase нет (проверено grep). Когда будет — копировать passportDefaults целиком (там id узлов, не тексты). showcase-bulk.ts (~29–48) мержит passportDefaults поверхностно: для textChoices мерж по ключам раздела, иначе пакетная правка сотрёт чужие выборы.
- Смена категории изделия: выборы, невидимые новой категории, не стираем, показываем как «не подходит» и считаем недостающими.
- Правка справочника: черновик пересобирается при открытии, если max(updatedAt) узлов passportPhrases новее textSnapshot.at (один агрегат, дёшево); выпуск фиксирует снимок (passport-issue.ts:32 уже так делает), выпущенный не меняется.
- «Чего не хватает»: missingKeyed (product-passport.service.ts ~319) дополнить ключами choice:РАЗДЕЛ для корней с required, где у категории есть варианты, а выбора нет или он невидим.

## 3. Дубли в коде и как свести
- passportInstall.montage и passportPhrases section installation: текст — в дереве, passportInstall остаётся физическим способом (схемы, requiredImages, baseRequirements). installText() (passport-compose-parts.ts:162) читает montage/mountText — оставить запасным путём; если у паспорта есть выбор по разделу установки, берётся текст листа. Поле montage не удалять (старые снимки, kppdf), в форме справочника скрыть после миграции.
- productpassports.purpose/installationMethod не удалять (общая коллекция, kppdf, PDF v1): становятся производными от textChoices; ручной ввод только по флагу «свой текст» (manualText, form.js:168).
- elements.purpose (purposeText(), compose-parts:86) — третий источник «назначения»: оставить запасным, если раздел purpose без выбора.
- GET passports/phrases (passport-queries.ts:70, группирует по тексту паспортов) заменить новым эндпоинтом; старый удалить после смены клиента (мёртвый код).

## 4. Миграция (порядок обязателен)
1. Хранитель: scripts/passport-text-dupes.js (план, затем --apply, бэкап) — слияние дублей в passportPhrases и passportInstall. До переноса.
2. Новый scripts/passport-funnel-migrate.js: по умолчанию «план», запись --apply, перед записью выгрузка passportPhrases и passportInstall в JSON. Для каждой записи без parentId: найти или создать корень по section (purpose, installation), записать parentId, allCategories = (categories пусто), order; passportInstall.montage непустой и без совпадающего листа — лист под корнем installation с installTypeId. Идемпотентен (метка funnelV=1). Тексты старых паспортов не переносить (решение пользователя). Остальные разделы наполняет аналитик/менеджер в редакторе.
3. Индексы не меняются, ensure-indexes.js не нужен. Mongo 4.4: только find/update.
Риск: корни — записи без text, попадут в старые списки (dictRows passportPhrases). Старый form.js должен игнорировать записи без text; backend и frontend выкладывать вместе.

## 5. Скорость
Один запрос GET /api/product-passports/passports/funnel?category=WRK (Roles VIEW, AppSection passports/products; объявить до :id-маршрутов). Читает passportPhrases один раз, в памяти отдаёт отфильтрованное дерево sections[] (key, title, required, options[] с вложенными children либо text); кэш DataVersionService.cached, зависимость dict_values. Форма паспорта вместо dictRows passportPhrases (form.js:50) использует его. Остальные 6 справочников формы (там же, строка 50) — отдельный шаг: ленивая загрузка по открытию блока.

## Правки по файлам
Backend, по порядку:
1. dicts/dicts.defs.ts — passportPhrases: поля parentId, allCategories, order, required, slot, installTypeId; проверки в toDoc; usage/related/reassign.
2. product-passport/passport-v2-text.ts:buildV2Text и passport-compose-parts.ts:installText/purposeText — слой выбора; product-passport.service.ts:snapshot — загрузка узлов, пересборка черновика; missingKeyed — ключи choice:*.
3. product-passport.schema.ts и dto/ — textChoices; passport-queries.ts — funnel(category); product-passport.controller.ts — маршрут.
4. showcase/passport-defaults.ts:normalizePassportDefaults и presentPassportDefaults — textChoices; showcase-bulk.ts — мерж; showcase.service.ts (~185).
5. Выпуск от изделия: showcase-from-passports.ts:101 и passport-issue.ts — textChoices и производные purpose/installationMethod.
6. scripts/passport-funnel-migrate.js и spec на дерево (видимость, глубина, авто-единственный, merge). Доки: MAP.md, PASSPORTS-V2.md §3.3 и §10.
Frontend (сначала skill datacore-design, ввод — правая панель):
1. pwa/sections/passports/form.js:50,120-122 — вместо двух combo «Установка/Назначение» блок воронки: шаги «выбрал, показаны 1–3 варианта, лист»; единственный вариант ставится сам; пустое помечено «не хватает».
2. wire-form.js:94-99 — убрать подстановку по способу установки (заменяет installTypeId листа).
3. pwa/sections/passports/product-block.js, models.js, products.js — выборы в блоке «Паспорт» изделия (пишутся в passportDefaults.textChoices).
4. pwa/sections/passport-texts.js и dicts.js — редактор дерева: узлы, галочки категорий и «Для всех», порядок, предпросмотр.
