# Playbook: DTO и OpenAPI по касанию эндпоинта

Одна ссылка для агента фичи. АБЗ-6 без big-bang. Замок **L-258**: пакетный перевод всех `@Query` запрещён.

Глобальный pipe (`backend/src/main.ts:247`): `whitelist` + `forbidNonWhitelisted: true` + `transform`. Лишнее поле класса → **400** (`property <name> should not exist`). Пока аргумент `Record<string, string>` / `Record<string, unknown>`, метатип `Object`: pipe класс не проверяет, клиентские ключи проходят. Замена на неполный класс сразу даёт 400 тем, кто эти ключи шлёт.

## Когда

Трогаешь один существующий эндпоинт: новое поле входа, баг валидации, описание ответа. Не открывай задачу «перевести все списки».

## Шаги

1. Зафиксируй метод, путь и текущий аргумент: класс или `Record`.
2. Собери **все** ключи, которые уже уходят на этот путь. Пустой инвентарь = стоп, класс не вешать.
   - PWA: `rg` по пути в `backend/pwa` (`api('…'`, `query:`). `core/api.js` выкидывает `undefined` / `null` / `''`, остальные ключи шлёт как есть. Число `1` в query становится строкой `"1"`.
   - Админка: `backend/admin` (`URLSearchParams`).
   - Внешние и машинные клиенты: `docs/CONNECT.md`, ключи `kppd_`, живой вызов, если путь публичный. CRM с той же базой по HTTP этот путь не обязан звать — проверь, если контракт общий.
3. Класс — на **весь** инвентарь, не на одно новое поле. Частичный DTO на бывшем `Record` отклоняет остальные ключи (урок МИ.2, `docs/roles/backend.md`). Новое поле при неполном инвентаре разбирай в сервисе, ответ 400 по-русски, тип аргумента не сужай.
4. Поля: `class-validator` + `@ApiProperty` / `@ApiPropertyOptional`. Необязательное — `@IsOptional`. Query не размечай `@IsBoolean()` / `@IsInt()` без проверки живого клиента: по умолчанию это строки. Флаги `0`/`1` — `@IsIn(['0','1'])`, как `FinancialArticleQueryDto`. `@Type(() => Number)` — только если клиент уже шлёт число и это проверено.
5. Контроллер: `@Query() q: XxxQueryDto` или `@Body() dto`. `@Roles` не снимать. Локальный pipe **без** `forbidNonWhitelisted` — только явной строкой в ТЗ этого эндпоинта, не как способ закрыть АБЗ-6.
6. Проверка до коммита.
   - Каждый ключ инвентаря даёт не 400.
   - Лишний ключ даёт 400. Обычный e2e-харнесс этого не ловит: `backend/test/setup/test-db.ts:88` ставит `forbidNonWhitelisted` только при `createTestApp({ strictValidation: true })`. Без флага лишнее поле молча отбрасывается (ложный 200).
7. Контракт изменился — OpenAPI по skill `datacore-verify` §4 (`export-openapi.js`, diff не должен молча стереть чужие пути). Строка маршрута — `docs/MAP.md`. Ручной пересбор всего `docs/openapi.json` не делать.
8. Один эндпоинт — одна поставка. Соседние списки не переводить.

## Образец позже

Новый перевод живого списка в C258 **не делался**. Риск нового 400 не нулевой.

Ближайший контрпример в том же контроллере: `GET /api/showcase` всё ещё `@Query() q: Record<string, string>` (`showcase.controller.ts:27`). Клиент и `@ApiQuery` уже шлют `search`, `groupId`, `series`, `deleted`, `status`, `page`, `limit`, `facets`, `needsIdentification`. Класс без этих ключей сломает список изделий. Админка и `kppd_` для этого пути в этапе не инвентаризированы.

**Образец позже** — первый такой список, когда шаги 1–6 закрыты по полному инвентарю и лишний ключ проверен со `strictValidation: true`.

Эталон для чтения, файлы этапа его не меняли (узкий query, поля совпадают с PWA):

- `GET /api/showcase/similar` — `SimilarQueryDto` (`similar-query.dto.ts:4`): `name`, `excludeId`. Вызов: `backend/pwa/ui/kit/similar.js` (только эти ключи). Контроллер: `showcase.controller.ts:36`.
- `GET /api/financial-articles` — `FinancialArticleQueryDto` (`financial-article.dto.ts:15`): `type`, `includeArchived`, `includeUsage` как `'0'`/`'1'`. Вызов: `backend/pwa/sections/financial-articles.js`. Контроллер: `expense-articles.controller.ts:24`.

## Не делать

- Пакет всех `@Query` или общий `ListQueryDto` на все списки одним заходом.
- Ослаблять pipe в `main.ts`.
- Считать зелёный e2e без `strictValidation: true` доказательством, что лишнее поле отклоняется.
