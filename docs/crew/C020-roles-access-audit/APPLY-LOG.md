# APPLY-LOG — волна A, роли на проде

Дата: 2026-11-04. Разрешение координатора: только PATCH ролей (label, money, appSections).  
`warehouseIds`, `baseRole`, `name`, `permissions` не отправлялись.

| name | id | тело | итог |
| --- | --- | --- | --- |
| admin | 6aa5da1fa523ba3a75de056f | `{"label":"Администратор"}` | ok |
| director | 6aa5da1fa523ba3a75de0593 | `{"appSections":["home","requests","stock","salesorders","partners","products","docs","passports","orders","money","payroll","work","offers"]}` | ok |
| accountant | 6ad6dc0cd7aa4250cd51e3f1 | `{"appSections":["home","requests","salesorders","partners","orders","money","payroll"]}` | ok |
| manager | 6aa5da1fa523ba3a75de05b2 | `{"appSections":["home","requests","suppliercatalog","stock","salesorders","partners","products","docs","passports","orders","money","offers"]}` | ok |
| user | 6aa5da1fa523ba3a75de05cd | `{"label":"Наблюдатель","appSections":["home","salesorders","products","partners"]}` | ok |
| r-59b301 | 6adc6ae3df625ddc7ed6807d | `{"money":false,"appSections":["home","design","products","docs","passports"]}` | ok |
| r-67c6b0 | 6ae44685cdc3f92ad170dbb2 | `{"money":false,"appSections":["stock"]}` | ok, складов 2 |
| r-be62f7 | 6ae44687cdc3f92ad170dbb8 | `{"money":false,"appSections":["stock"]}` | ok, складов 1 |
| Кладовщик плит (телефон) | 6ae9bb8c0763e430e8cf8273 | `{"label":"Кладовщик плит (телефон)"}` | ok, money уже false, складов 1 |
| r-99ca58 | 6adc6a2edf625ddc7ed68042 | не слали | уже совпадает: Кладовщик, money false, stock-mobile, складов 1 |

Ошибок нет. Повторный `GET /api/roles` совпал с целью. Счётчики `warehouseIds` не изменились.
