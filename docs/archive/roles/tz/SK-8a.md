# ТЗ SK-8a — видимость разделов по роли (сервер + админка)

**Зачем (словами пользователя):** у кладовщика, инженера, бухгалтера — свои разделы; в «Ролях» ставлю галочки, какие разделы роль видит (SKLAD §6 SK-8, решение архитектора — SKLAD §8 строка «Видимость разделов»).

**Роли:** backend ☐ · frontend (SK-8b, после) · qa ☐ · архитектор ☐ (проверка итога)

## Решение архитектора (SKLAD §8, не переобсуждать)
- `roles.appSections?: string[]` — значения только из константы `backend/src/common/app-sections.ts` (ид и русское название разделов «Рабочего места»: home, requests, stock, salesorders, partners, products, passports, orders, money, payroll — сверить с `NAV` в `backend/pwa/main.js`).
- Пусто / нет поля = как сейчас (видимость по иерархии роли). Админ видит всё всегда.
- `/auth` (me / ответ входа — где приложение берёт `session.user`) отдаёт `sections: string[] | null` (null = «как сейчас»).
- Это **только видимость**: права на маршрутах (@Roles, permissions, MoneyMask) не трогать.
- «Две роли у человека» — пока новая роль-сочетание в «Ролях»; `users.extraRoles` (SK-8b-позже) — НЕ в этом ТЗ.

## Что сделать
1. `common/app-sections.ts` — список разделов (id + название), экспорт для DTO и `GET` списка (например `GET /api/roles/app-sections` или поле в существующем мета-ответе — по месту, коротко).
2. `role.schema.ts` + DTO создания/правки роли: `appSections` (необязательно, `@IsIn` по константе, массив ≤ 30). Коллекция `roles` — проверь, не общая ли с CRM kppdf (`collections-admin.controller.ts`, `kind:'crm'`): поле только добавочное, необязательное — CRM не ломается.
3. Ответ `/auth` — `sections` у пользователя по его роли.
4. Админка (`backend/admin`, экран «Роли»): галочки разделов у роли, сохранение. По скиллу `datacore-design`. (Админка — зона frontend, но это 1 экран, тесно с сервером — делаешь ты; в отчёте перечисли.)
5. Юнит: DTO отвергает чужой раздел; `/auth` отдаёт null при пустом и список при заполненном; admin — всегда null/всё.
6. `docs/MAP.md`, `docs/data-model.md`; `docs/openapi.json` перегенерировать (skill `datacore-verify`).

## Файлы
- В рабочей копии ожидаются правки: `backend/src/modules/stock/dto.ts`, `stock-reservations.service.ts`, `stock-reservations.service.spec.ts` (координатор, SK-6c — не трогать); `backend/pwa/**` (frontend, SK-6c); `docs/roles/tz/SK-6c.md`, `SK-8a.md`, `SK-8b.md`.
- читать: `docs/roles/README.md`, `docs/roles/backend.md`, `docs/roles/tz/SKLAD.md` §8, `src/modules/role/*`, `src/modules/auth/auth.service.ts`, `backend/pwa/main.js` (только `NAV`), экран ролей в `backend/admin/`.
- менять: `backend/src/**`, `backend/test/**`, `backend/admin/**` (только экран ролей), `docs/MAP.md`, `docs/data-model.md`, `docs/openapi.json`.

## Критерии приёмки
- [ ] Роль без `appSections` и все старые пользователи, ключи `kppd_` работают как раньше; CRM-поля ролей не тронуты.
- [ ] В админке у роли галочки разделов, сохраняются, после перезагрузки на месте.
- [ ] `/auth` отдаёт `sections`; неизвестный раздел в DTO — 400 по-русски.
- [ ] tsc 0, `npx jest src/modules/role src/modules/auth --silent` зелёные, admin — `--input-type=module --check`.

## Нельзя
- Права на маршрутах, `users.role`, данные прода, `backend/pwa`; коммитить.
