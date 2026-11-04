# Роли на проде

Источник: `GET /api/roles` (prod), 2026-11-04, после волны A. Ролей: **10**. Все `isActive: true`.

Пустая ячейка (`—`) — поля нет в документе. `warehouseIds count` — длина массива (нет массива = 0).

| name | label | baseRole | money | appSections | warehouseIds count | active |
| --- | --- | --- | --- | --- | --- | --- |
| Кладовщик плит (телефон) | Кладовщик плит (телефон) | manager | false | stock-mobile | 1 | true |
| admin | Администратор | — | — | — | 0 | true |
| director | Директор | — | — | home, requests, stock, salesorders, partners, products, docs, passports, orders, money, payroll, work, offers | 0 | true |
| accountant | Бухгалтер | — | — | home, requests, salesorders, partners, orders, money, payroll | 0 | true |
| manager | Менеджер | — | — | home, requests, suppliercatalog, stock, salesorders, partners, products, docs, passports, orders, money, offers | 0 | true |
| r-59b301 | Проектировщик | manager | false | home, design, products, docs, passports | 0 | true |
| r-67c6b0 | Трубарез | manager | false | stock | 2 | true |
| r-99ca58 | Кладовщик | manager | false | stock-mobile | 1 | true |
| r-be62f7 | Лазер лист | manager | false | stock | 1 | true |
| user | Наблюдатель | — | — | home, salesorders, products, partners | 0 | true |
