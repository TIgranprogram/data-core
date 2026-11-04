# Роли на проде

Снимок: GET /api/roles (prod), 2026-11-04. Только чтение.
Колонка active — поле isActive. Знак «—» — поля в документе нет.
warehouseIds — число id. appSections — список id разделов.

| name | label | baseRole | money | appSections | warehouseIds | active |
|---|---|---|---|---|---|---|
| admin | Administrator | — | — | — | — | true |
| director | Директор | — | — | home, requests, stock, salesorders, partners, products, passports, orders, money, payroll | — | true |
| accountant | Бухгалтер | — | — | home, requests, stock, salesorders, partners, products, passports, orders, money, payroll | — | true |
| manager | Менеджер | — | — | home, requests, suppliercatalog, stock, salesorders, partners, products, docs, passports, orders, money, payroll, offers | — | true |
| Кладовщик плит (телефон) | — | manager | false | stock-mobile | 1 | true |
| r-59b301 | Проектировщик | manager | — | home, requests, suppliercatalog, stock, salesorders, partners, products, docs, passports, design | — | true |
| r-67c6b0 | Трубарез | manager | — | stock | 2 | true |
| r-99ca58 | Кладовщик | manager | false | stock-mobile | 1 | true |
| r-be62f7 | Лазер лист | manager | — | stock | 1 | true |
| user | User | — | — | — | — | true |

Всего ролей: 10.

