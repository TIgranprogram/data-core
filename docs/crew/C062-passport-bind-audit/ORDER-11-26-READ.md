# Заказ 11-26 (prod, только чтение)

Дата съёма: 2026-11-11. Источник: `GET /api/salesorders`, карточка, `/passports/order/.../plan`, `/showcase/:id`, `/passport-gaps`, `/passports?productId=`.

## 1. Шапка заказа

| Поле | Значение |
|------|----------|
| id | `6ad6cd5d8913226b0cb530cd` |
| orderNo (договор) | 9 |
| productionNo | **11-26** |
| customer | ИП Сахаджи |
| status / stage | partly (Частично отгружен) |
| company | СИЮ (`6ad52bec863df73f344ea489`) |

Поиск: `GET /api/salesorders?search=11-26` → один договор, ключ **productionNo=11-26**, orderNo=9.

## 2. Позиции (incomes / lines)

Всего строк в карточке: **19**. В плане паспортов (без отменённых): **12**.

**Признак «мы / не мы» в API:** прямого `isOwn` / `production` на позиции нет. Использованы: `status=cancelled`, `cancelledAt`, `cancelReason` («Передан другому исполнителю»), `matchStatus`, `productId`, `lineType` (не задан), `source=import-xlsx`.

| № | incomeId | sku | название | qty | статус | исключение |
|---|----------|-----|----------|-----|--------|------------|
| 1 | `6ad6cd5d8913226b0cb530ce` | 3504 | Деревянная урна | 29 | cancelled | не мы / отмена |
| 2 | `6ad6cd5d8913226b0cb530d0` | 3906 | Деревянная табличка на цепи | 4 | cancelled | не мы / отмена |
| 3 | `6ad6cd5d8913226b0cb530d2` | 3905 | Арт объект Деревянные указатели | 17 | awaiting | — |
| 4 | `6ad6cd5d8913226b0cb530d4` | 3207 | Стелла | 1 | awaiting | — |
| 5 | `6ad6cd5d8913226b0cb530d6` | 6101 | Игровой комплекс | 1 | cancelled | не мы / отмена |
| 6 | `6ad6cd5d8913226b0cb530d8` | 3213 | Арт объект: Деревянные качели | 1 | cancelled | не мы / отмена |
| 7 | `6ad6cd5d8913226b0cb530da` | 6001 | Игровой элемент | 1 | cancelled | не мы / отмена |
| 8 | `6ad6cd5d8913226b0cb530dc` | 6102 | Игровой комплекс | 1 | awaiting | исключение артикул 6102 |
| 9 | `6ad6cd5e8913226b0cb530de` | 6103 | Игровой комплекс | 1 | awaiting | исключение артикул 6103 |
| 10 | `6ad6cd5e8913226b0cb530e0` | 3210 | Мостик | 1 | awaiting | — |
| 11 | `6ad6cd5e8913226b0cb530e2` | 3601 | Шахматный стол со стульями | 2 | awaiting | — |
| 12 | `6ad6cd5e8913226b0cb530e4` | 3208 | Качели | 1 | cancelled | не мы / отмена |
| 13 | `6ad6cd5e8913226b0cb530e6` | 3206 | Качели | 5 | awaiting | — |
| 14 | `6ad6cd5e8913226b0cb530e8` | 3209 | Качели | 3 | awaiting | — |
| 15 | `6ad6cd5e8913226b0cb530ea` | 3211 | Деревянный гамак | 3 | awaiting | — |
| 16 | `6ad6cd5e8913226b0cb530ec` | 3212 | Шезлонг | 7 | awaiting | — |
| 17 | `6ad6cd5e8913226b0cb530ee` | 3218 | Прочие МАФы 4 1800х2000х1400 (смета) | 1 | awaiting | — |
| 18 | `6ad6cd5e8913226b0cb530f0` | 3215 | Экотропа 120 м.п. | 1 | awaiting | — |
| 19 | `6ad6cd5e8913226b0cb530f1` | — | Ограждение деревянное (h=1200 мм) 28м | 1 | cancelled | не мы / отмена |

### Сводка для подготовки паспортов

- Всего позиций в карточке: **19**
- Отменено («не мы»): **7**
- Исключено по артикулу 6102/6103: **2**
- **К подготовке (активные, без 6102/6103): 10**
- Живых паспортов на заказ (plan): issued=0, ready=0, blocked=12

## 3–4. Позиции к подготовке: паспорт + изделие

### Стр. 3 — 3905 Арт объект Деревянные указатели

- incomeId: `6ad6cd5d8913226b0cb530d2` · productId: `6adaff432a8dad6034b14603` · qty: 17
- Паспорт на позицию: **нет** · state: blocked
- План missing (кратко): Материалы; Назначение; Рисунок: Чертёж с размерами; Рисунок: Схема фундамента
- Категория паспорта: `BLG` Благоустройство [own]
- canPassport: true; missing на изделии: нет
- passportDefaults: гарантия=12, срок=10, joints=есть, isKit=—, textOverrides=нет, elements=0
- Фото: да (1); габариты L/W/H: length=нет, width=нет, height=нет, weight=нет
- Другие паспорта по productId (живые): №500 issued firm=СИЮ
- passport-gaps: blg.fence:Элемент ограждения, blg.seats:Мест, blg.seat:Сиденье, blg.rail:Перила, спинка, blg.material:Материал, materials:Материалы, purpose:Назначение, img_dimensions:Рисунок: Чертёж с размерами, img_foundation:Рисунок: Схема фундамента

### Стр. 4 — 3207 Стелла

- incomeId: `6ad6cd5d8913226b0cb530d4` · productId: `6addd770c93bb8ea2a6e3969` · qty: 1
- Паспорт на позицию: **нет** · state: blocked
- План missing (кратко): Габариты; Вес; Материалы; Назначение; Фото изделия; и ещё 3
- Категория паспорта: `BLG` Благоустройство [own]
- canPassport: true; missing на изделии: нет
- passportDefaults: гарантия=—, срок=10, joints=есть, isKit=—, textOverrides=нет, elements=0
- Фото: да (1); габариты L/W/H: length=нет, width=нет, height=нет, weight=нет
- Другие паспорта по productId (живые): нет
- passport-gaps: blg.fence:Элемент ограждения, blg.seats:Мест, blg.seat:Сиденье, blg.rail:Перила, спинка, blg.material:Материал, height:Габариты, weight:Вес, materials:Материалы, purpose:Назначение, img_overview:Фото изделия, installationTypeId:Способ установки, img_dimensions:Рисунок: Чертёж с размерами…

### Стр. 10 — 3210 Мостик

- incomeId: `6ad6cd5e8913226b0cb530e0` · productId: `6addd770c93bb8ea2a6e3972` · qty: 1
- Паспорт на позицию: **нет** · state: blocked
- План missing (кратко): Габариты; Вес; Материалы; Назначение; Фото изделия; и ещё 3
- Категория паспорта: `BLG` Благоустройство [own]
- canPassport: true; missing на изделии: нет
- passportDefaults: гарантия=—, срок=10, joints=есть, isKit=—, textOverrides=нет, elements=0
- Фото: да (1); габариты L/W/H: length=нет, width=нет, height=нет, weight=нет
- Другие паспорта по productId (живые): нет
- passport-gaps: blg.fence:Элемент ограждения, blg.seats:Мест, blg.seat:Сиденье, blg.rail:Перила, спинка, blg.material:Материал, height:Габариты, weight:Вес, materials:Материалы, purpose:Назначение, img_overview:Фото изделия, installationTypeId:Способ установки, img_dimensions:Рисунок: Чертёж с размерами…

### Стр. 11 — 3601 Шахматный стол со стульями

- incomeId: `6ad6cd5e8913226b0cb530e2` · productId: `6addd772c93bb8ea2a6e39a2` · qty: 2
- Паспорт на позицию: **нет** · state: blocked
- План missing (кратко): Габариты; Вес; Материалы; Фото изделия; Способ установки; и ещё 2
- Категория паспорта: `BLG` Благоустройство [own]
- canPassport: true; missing на изделии: нет
- passportDefaults: гарантия=—, срок=10, joints=есть, isKit=—, textOverrides=нет, elements=1
- Фото: да (1); габариты L/W/H: length=нет, width=нет, height=нет, weight=нет
- Другие паспорта по productId (живые): нет
- passport-gaps: blg.fence:Элемент ограждения, blg.seats:Мест, blg.seat:Сиденье, blg.rail:Перила, спинка, blg.material:Материал, height:Габариты, weight:Вес, materials:Материалы, img_overview:Фото изделия, installationTypeId:Способ установки, img_dimensions:Рисунок: Чертёж с размерами, warrantyMonths:Гарантия, мес.

### Стр. 13 — 3206 Качели

- incomeId: `6ad6cd5e8913226b0cb530e6` · productId: `6adaff432a8dad6034b14604` · qty: 5
- Паспорт на позицию: **нет** · state: blocked
- План missing (кратко): Назначение; Рисунок: Чертёж с размерами; Рисунок: Схема фундамента; Пользователей одновременно
- Категория паспорта: `BLG` Благоустройство [own]
- canPassport: true; missing на изделии: нет
- passportDefaults: гарантия=12, срок=10, joints=есть, isKit=false, textOverrides=нет, elements=0
- Фото: да (1); габариты L/W/H: length=нет, width=нет, height=нет, weight=нет
- Другие паспорта по productId (живые): №501 issued firm=СИЮ
- passport-gaps: blg.fence:Элемент ограждения, blg.seats:Мест, blg.seat:Сиденье, blg.rail:Перила, спинка, blg.material:Материал, purpose:Назначение, img_dimensions:Рисунок: Чертёж с размерами, img_foundation:Рисунок: Схема фундамента, maxUsers:Пользователей одновременно

### Стр. 14 — 3209 Качели

- incomeId: `6ad6cd5e8913226b0cb530e8` · productId: `6addd770c93bb8ea2a6e396f` · qty: 3
- Паспорт на позицию: **нет** · state: blocked
- План missing (кратко): Габариты; Вес; Материалы; Фото изделия; Способ установки; и ещё 9
- Категория паспорта: `DIO` Детское игровое оборудование [own]
- canPassport: true; missing на изделии: нет
- passportDefaults: гарантия=—, срок=10, joints=есть, isKit=—, textOverrides=нет, elements=1
- Фото: да (1); габариты L/W/H: length=нет, width=нет, height=нет, weight=нет
- Другие паспорта по productId (живые): нет
- passport-gaps: dio.age:Возраст детей, dio.seats:Мест, dio.material:Материал, height:Габариты, weight:Вес, materials:Материалы, img_overview:Фото изделия, installationTypeId:Способ установки, ageFrom:Возраст от, ageTo:Возраст до, maxUsers:Пользователей одновременно, fallHeight:Высота свободного падения…

### Стр. 15 — 3211 Деревянный гамак

- incomeId: `6ad6cd5e8913226b0cb530ea` · productId: `6addd770c93bb8ea2a6e3975` · qty: 3
- Паспорт на позицию: **нет** · state: blocked
- План missing (кратко): Габариты; Вес; Материалы; Назначение; Фото изделия; и ещё 3
- Категория паспорта: `BLG` Благоустройство [own]
- canPassport: true; missing на изделии: нет
- passportDefaults: гарантия=—, срок=10, joints=есть, isKit=—, textOverrides=нет, elements=0
- Фото: да (1); габариты L/W/H: length=нет, width=нет, height=нет, weight=нет
- Другие паспорта по productId (живые): нет
- passport-gaps: blg.fence:Элемент ограждения, blg.seats:Мест, blg.seat:Сиденье, blg.rail:Перила, спинка, blg.material:Материал, height:Габариты, weight:Вес, materials:Материалы, purpose:Назначение, img_overview:Фото изделия, installationTypeId:Способ установки, img_dimensions:Рисунок: Чертёж с размерами…

### Стр. 16 — 3212 Шезлонг

- incomeId: `6ad6cd5e8913226b0cb530ec` · productId: `6addd770c93bb8ea2a6e3978` · qty: 7
- Паспорт на позицию: **нет** · state: blocked
- План missing (кратко): Габариты; Вес; Материалы; Назначение; Фото изделия; и ещё 3
- Категория паспорта: `BLG` Благоустройство [own]
- canPassport: true; missing на изделии: нет
- passportDefaults: гарантия=—, срок=10, joints=есть, isKit=—, textOverrides=нет, elements=0
- Фото: да (1); габариты L/W/H: length=нет, width=нет, height=нет, weight=нет
- Другие паспорта по productId (живые): нет
- passport-gaps: blg.fence:Элемент ограждения, blg.seats:Мест, blg.seat:Сиденье, blg.rail:Перила, спинка, blg.material:Материал, height:Габариты, weight:Вес, materials:Материалы, purpose:Назначение, img_overview:Фото изделия, installationTypeId:Способ установки, img_dimensions:Рисунок: Чертёж с размерами…

### Стр. 17 — 3218 Прочие МАФы 4 1800х2000х1400 (смета)

- incomeId: `6ad6cd5e8913226b0cb530ee` · productId: `6ae440f6f08b6a47889f4859` · qty: 1
- Паспорт на позицию: **нет** · state: blocked
- План missing (кратко): Габариты; Вес; Материалы; Назначение; Фото изделия; и ещё 3
- Категория паспорта: `BLG` Благоустройство [own]
- canPassport: true; missing на изделии: нет
- passportDefaults: гарантия=—, срок=10, joints=есть, isKit=—, textOverrides=нет, elements=0
- Фото: да (1); габариты L/W/H: length=нет, width=нет, height=нет, weight=нет
- Другие паспорта по productId (живые): нет
- passport-gaps: blg.fence:Элемент ограждения, blg.seats:Мест, blg.seat:Сиденье, blg.rail:Перила, спинка, blg.material:Материал, height:Габариты, weight:Вес, materials:Материалы, purpose:Назначение, img_overview:Фото изделия, installationTypeId:Способ установки, img_dimensions:Рисунок: Чертёж с размерами…

### Стр. 18 — 3215 Экотропа 120 м.п.

- incomeId: `6ad6cd5e8913226b0cb530f0` · productId: `6addd770c93bb8ea2a6e3981` · qty: 1
- Паспорт на позицию: **нет** · state: blocked
- План missing (кратко): Габариты; Вес; Материалы; Назначение; Фото изделия; и ещё 3
- Категория паспорта: `BLG` Благоустройство [own]
- canPassport: true; missing на изделии: нет
- passportDefaults: гарантия=—, срок=10, joints=есть, isKit=—, textOverrides=нет, elements=0
- Фото: да (1); габариты L/W/H: length=нет, width=нет, height=нет, weight=нет
- Другие паспорта по productId (живые): нет
- passport-gaps: blg.fence:Элемент ограждения, blg.seats:Мест, blg.seat:Сиденье, blg.rail:Перила, спинка, blg.material:Материал, height:Габариты, weight:Вес, materials:Материалы, purpose:Назначение, img_overview:Фото изделия, installationTypeId:Способ установки, img_dimensions:Рисунок: Чертёж с размерами…

## 5. Наши фирмы (GET /api/partners?type=our)

| id | name |
|----|------|
| `6ad52bec863df73f344ea489` | СИЮ (ООО «СпортИН-ЮГ») |
| `6ad52bed863df73f344ea517` | ССЮ (ООО «СпортСтройЮг») |
| `6aeb05349257daffedf6ae2f` | ООО «Приват-деал» |

Заказ оформлен на **СИЮ** — логичный `supplierOrgId` для выпуска, если не выбрано иное.

## 6. POST /passports/check

Не вызывался (достаточно `plan` + `passport-gaps`; check — POST, по ТЗ допустим как read-only, но не нужен).

## Топ дыр шаблона (по plan.missing)

- Материалы: 9 поз.
- Назначение: 8 поз.
- Габариты: 8 поз.
- Вес: 8 поз.
- Фото изделия: 8 поз.
- …доп. поля: 8 поз.
- Рисунок: Чертёж с размерами: 2 поз.
- Рисунок: Схема фундамента: 2 поз.
- Способ установки: 2 поз.
- Пользователей одновременно: 1 поз.
