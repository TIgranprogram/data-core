# C070 — числа прода (только чтение), 2026-11-11, ~13:38 UTC

## 1. Паспорта (всего 343)
| Показатель | Значение |
|--|--|
| Всего (без корзины) | 343 |
| Выпущено / черновик / аннулировано | 332 / 10 / 1 |
| Выпущено за 7 дней (поле `date`) | 1 |
| Выпущено за 30 дней (поле `date`) | 7 |
| Без привязки к изделию (`productId` пуст) | 8 (все выпущены, из таблицы) |
| С файлом печати (`printFile.hasFile`) | 0 |
| «С сайта» (`source=app`) | 14 из 343 (остальные 329 — `sheet:Pasports`, импорт таблицы) |
| Изделий с хотя бы одним паспортом (distinct `productId`) | 248 |

Примечание: `issuedAt` и `createdAt` почти у всех из импорта (октябрь 2026), поэтому «за 30 дней» по ним = 332 — не брать.

## 2. Изделия (витрина `/api/showcase`, всего 491)
| Статус | Число |
|--|--|
| draft | 474 |
| active | 16 |
| new | 1 |

| Показатель | Значение |
|--|--|
| Активных изделий | 16 |
| Изделий со `passportsCount > 0` (все статусы) | 240 из 491 |
| Активных с паспортом | 1 из 16 |
| Пробелы по `/showcase/:id/passport-gaps` | НЕ собраны (лимит 25 запросов; у активных 16, не 50) |

Поле `missing` в списке витрины у всех активных пустое — это не тот расчёт, что `passport-gaps`, по нему топ не строился.

## 3. КП (`/api/offers`)
| Показатель | Значение |
|--|--|
| Всего | 1 |
| По статусам | draft 1; sent, accepted, paid, rejected, cancelled — по 0 |
| По нашим фирмам | ССЮ — 1 |
| Создано за 7 и 30 дней | 1 и 1 |
| С заказом (`orderId`) | 0 |
| С итогом 0 | 0 |

## 4. Наши компании (`isOurCompany`, 3 из 33 организаций)
| Компания | Фон КП (свой, по умолчанию) | Ставка НДС по умолчанию | Режим НДС |
|--|--|--|--|
| СИЮ | 1 | 22 | с НДС |
| ССЮ | 1 | 22 (из КП; отдельный запрос не делался) | с НДС |
| ООО «Приват-деал» | 2 (один по умолчанию) | 22 | с НДС |

Организаций всего 33: поставщики 28, заказчики 1, без типа 4. Встроенных фонов без компании 2.

## 5. Журнал действий (`/api/audit-logs`, с 2026-10-12, 30 дней)
| Раздел | Действий |
|--|--|
| Паспорта (`ProductPassport`) | 167 |
| КП (`CommercialOffer`) | 33 |

## Не удалось / не сделано
- Пробелы паспорта для 50 изделий: не собраны, нужно ~16 запросов на активные изделия; лимит 25 запросов выбран под остальные пункты.
- НДС для ССЮ по `/offers/defaults` не запрашивался (взято 22 из КП).
- Запросов к проду: 23 GET, все только чтение; ни одной записи.
- Выгрузки для расчётов лежат в scratchpad агента (вне репо), токены и персональные данные в файлы не писались.

## Категории паспорта: обязательные поля и значения по умолчанию (2026-11-11)

Источник: прод, `GET /api/dicts/passportCategories`, 1 запрос, только чтение. Всего категорий: 6.

| code | Название | Срок службы, лет | Гарантия, мес. | requiredFields | allowedFields | fieldDefaults | fieldHints (коротко) |
|--|--|--|--|--|--|--|--|
| BLG | Благоустройство | 5 | 12 | serviceLifeYears | maxUsers; siteLength; siteWidth; serviceLifeYears | — (пусто) | maxUsers — число мест; siteLength — место с проходами; serviceLifeYears — обычно 5 |
| WRK | Воркаут и спортивное оборудование | 10 | 12 | maxUsers; siteLength; siteWidth; serviceLifeYears | heightMin; heightMax; weightMax; maxUsers; siteLength; siteWidth; serviceLifeYears | — (пусто) | maxUsers — одновременно занимаются; weightMax — вес занимающегося; siteLength — с зоной безопасности |
| DIO | Детское игровое оборудование | 10 | 12 | ageFrom; ageTo; maxUsers; fallHeight; siteLength; siteWidth; serviceLifeYears | ageFrom; ageTo; maxUsers; fallHeight; siteLength; siteWidth; serviceLifeYears | ageFrom — 3 | ageFrom — обычно от 3 лет; fallHeight — по проекту; siteLength — с зоной приземления |
| DSP | Детское спортивное оборудование | 10 | 12 | ageFrom; maxUsers; siteLength; siteWidth; serviceLifeYears | ageFrom; ageTo; heightMin; maxUsers; fallHeight; siteLength; siteWidth; serviceLifeYears | ageFrom — 7 | ageFrom — обычно от 7 лет; siteLength — с зоной безопасности |
| TRN | Уличный тренажёр | 10 | 12 | heightMin; weightMax; maxUsers; siteLength; siteWidth; serviceLifeYears | heightMin; heightMax; weightMax; maxUsers; siteLength; siteWidth; serviceLifeYears | heightMin — 1400; weightMax — 120 | heightMin и weightMax — указывает изготовитель; serviceLifeYears — назначает изготовитель |
| ALL | Для всех | — (пусто) | 12 | — (пусто) | — (пусто) | — (пусто) | служебная: тексты для всех категорий |

Пустой `fieldDefaults` — у категорий BLG, WRK и ALL. Заполнен — у DIO, DSP, TRN.
