# Патч для CRM kppdf: поле `invoiceDate` у заявок снабжения

> Зачем: data-core (2026-10-19, TASKS Ф.1) добавил в общую коллекцию `supplyrequests` необязательное поле
> `invoiceDate` — дата счёта поставщика (платёжный календарь: расход ложится на эту дату).
> Коллекция общая с kppdf, схемы держим одинаковыми (AGENTS.md, «Единая база»). Поле **необязательное**,
> ничего не переименовано и не удалено — kppdf работает и без патча (поле ей не мешает; CRM меняет заявки
> точечными обновлениями, а не перезаписью документа). Патч нужен, чтобы CRM могла поле показывать и править.
>
> **Применять вручную в `D:\kppdf-8.0` по решению пользователя; агент data-core в kppdf не коммитит.**

## Изменение

Файл `D:\kppdf-8.0\backend\src\modules\supply\supply-request.schema.ts`, перед блоком `sheetExtra` (≈ строка 142):

```diff
+  /** Дата счёта поставщика (общее поле с data-core, 2026-10-19). Необязательное. */
+  @Prop({ type: Date, index: true, sparse: true })
+  invoiceDate?: Date;
+
   /** Колонки таблицы, для которых в схеме ещё нет поля (тип/дата счёта и т.п.) — переносятся как есть. */
   @Prop({ type: Object })
   sheetExtra?: Record<string, unknown>;
```

Копия схемы в data-core — `backend/src/modules/supply/supply-request.schema.ts` (то же поле, тот же комментарий).

## Проверка после применения (в kppdf)
1. `cd backend && pnpm exec tsc --noEmit` — 0 ошибок.
2. `pnpm exec jest src/modules/supply` — зелёные.
3. Хуки pre-commit/pre-push проходят штатно (без `--no-verify`).
4. Коммит в kppdf: `feat(supply): поле invoiceDate (общая коллекция с data-core)`.

## Данные
Существующие даты лежат в `sheetExtra.invoiceDate` строкой. Перенос — скрипт data-core
`backend/scripts/migrate-invoice-date.js` (dry-run по умолчанию, `--apply` — запись; на живой базе — только по «да»).
