# Целевое состояние ролей (прод)

| name | label | money | appSections (цель) |
|--|--|--|--|
| admin | Администратор | — | — (всё) |
| director | Директор | — | home, requests, stock, salesorders, partners, products, docs, passports, orders, money, payroll, work, offers |
| accountant | Бухгалтер | — | home, requests, salesorders, partners, orders, money, payroll |
| manager | Менеджер | — | home, requests, suppliercatalog, stock, salesorders, partners, products, docs, passports, orders, money, offers |
| user | Наблюдатель | — | home, salesorders, products, partners |
| r-59b301 | Проектировщик | **false** | home, design, products, docs, passports |
| r-67c6b0 | Трубарез | **false** | stock |
| r-be62f7 | Лазер лист | **false** | stock |
| r-99ca58 | Кладовщик | false (уже) | stock-mobile |
| Кладовщик плит (телефон) | **Кладовщик плит (телефон)** | false (уже) | stock-mobile |

`warehouseIds` не менять в этой волне (только сверить имена в отчёте). `baseRole` у своих ролей не менять.
