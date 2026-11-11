# Заказ 11-26 — источники заполнения паспорта (prod, read-only)

Съём 2026-11-11. Без фото и без length/width/height/weight в рекомендациях — их колонка «пользователь».

## Справочник: способы установки (`GET /api/dicts/passportInstall`)

| id | название |
|----|----------|
| `6ada090c7536f8509feb4244` | Анкеры на фундамент (`ANCHORS`) traits=concrete, anchors |
| `6ada090c7536f8509feb4243` | Бетонирование опор (`CONCRETE_POSTS`) traits=concrete |
| `6ada090c7536f8509feb4245` | На закладные детали (`EMBEDDED`) traits=— |
| `6ada090c7536f8509feb4247` | На покрытие (`ON_SURFACE`) traits=— |
| `6ada091046ad81616709da3d` | Ограждение на опорных стойках (`FENCE_POSTS`) traits=concrete |
| `6ada090c7536f8509feb4246` | Свободностоящий (`FREESTANDING`) traits=freestanding |
| `6af1cc81bde492a73d513db8` | Укладывается на основание (без крепления) (`LAID`) traits=freestanding |

## Шаблонные фразы (`GET /api/passports/texts`)

### BLG — purpose / installation

- `6adb5ab2edd024ba63d7f19f` Сбор мусора (purpose)
- `6adb5ab2edd024ba63d7f1a0` Ограждение (purpose)
- `6adb5ab2edd024ba63d7f1a1` Навес, беседка (purpose)
- `6adb5ab2edd024ba63d7f1a2` Отдых (purpose)
- `6adb5ab2edd024ba63d7f1a3` Озеленение (purpose)
- `6adb5ab2edd024ba63d7f1a4` Информирование (purpose)
- `6adb5ab2edd024ba63d7f1a5` Освещение (purpose)
- `6adb5ab2edd024ba63d7f1a6` Прочее благоустройство (purpose)
- `6aeea931e6cf14bd396f3b17` Зрительские места (purpose)
- `6adb5ab2edd024ba63d7f1b2` Бетонирование опорных стоек (installation)
- `6adb5ab2edd024ba63d7f1b3` Закладные детали (installation)
- `6adb5ab2edd024ba63d7f1b4` Анкерное крепление (installation)
- `6adb5ab2edd024ba63d7f1b5` Ограждение на опорных стойках (installation)
- `6adb5ab2edd024ba63d7f1b6` Свободная установка (installation)

### DIO — purpose / installation

- `6adb5ab2edd024ba63d7f1a7` **Игровое** [purpose]: Предназначено для игр и активного отдыха детей на детской игровой площадке.
- `6adb5ab2edd024ba63d7f1b7` **Бетонирование опорных стоек** [installation]: Изделие устанавливается на детских игровых площадках; опорные стойки бетонируют в грунт.
- `6adb5ab2edd024ba63d7f1b8` **Закладные детали** [installation]: Изделие устанавливается на детских игровых площадках и крепится к закладным деталям, забетонированным в основание.
- `6adb5ab2edd024ba63d7f1b9` **Анкерное крепление** [installation]: Изделие устанавливается на детских игровых площадках и крепится анкерными болтами к твёрдому основанию (бетонной плите, …
- `6adb5ab2edd024ba63d7f1bb` **Свободная установка** [installation]: Изделие устанавливается на детских игровых площадках на ровное твёрдое основание без крепления.

---

## 3905 · Арт объект Деревянные указатели (`6adaff432a8dad6034b14603`)

### Showcase (снимок)

| Поле | Значение |
|------|----------|
| passportCategory | BLG |
| group / type | Информационные стенды и указатели / Оборудование для благоустройства территории |
| purpose | — |
| description | Арт объект Деревянные указатели (в дальнейшем именуемое «Изделие»), изготовленное из деревянного бруса ∅136 мм и указательных досок из лиственницы с защитным маслом. Изделие устанавливается в местах общественного пользования методом прямого бетонирования опорного столба в грунт. Предназначено для навигации и указания направлений движения посетителей. |
| installation | — |
| materialsText | — |
| materialsSpec | null |
| composition | (пусто) |
| facetValueIds | [] |
| warrantyMonths | 12 |
| serviceLifeYears | 10 |
| ageFrom / ageTo | — / — |
| maxUsers | — |
| fallHeight | — |
| isKit | — |
| installationTypeId | Бетонирование опор (CONCRETE_POSTS) |
| joints | ["bolts","welds"] |

**passportDefaults (целиком):**

```json
{
  "passportCategory": "BLG",
  "installationTypeId": "6ada090c7536f8509feb4243",
  "textChoices": {
    "6add909915d601111692a40f": "6adb5ab2edd024ba63d7f1a4",
    "6add909915d601111692a410": "6adb5ab2edd024ba63d7f1b2"
  },
  "joints": [
    "bolts",
    "welds"
  ],
  "serviceLifeYears": 10,
  "warrantyMonths": 12
}
```

### passport-gaps

- **blg.fence** (Элемент ограждения) kind=facet req=false options=[Секция | Калитка | Стойка, столб]
- **blg.seats** (Мест) kind=facet req=false options=[до 5 | 10 | 15 | 20 | 25 и больше | Подъём (лестница) трибуны]
- **blg.seat** (Сиденье) kind=facet req=false options=[Пластик | Доска]
- **blg.rail** (Перила, спинка) kind=facet req=false options=[С перилами / со спинкой | Без перил / без спинки]
- **blg.material** (Материал) kind=facet req=false suggest=Дерево (или металл с деревом) options=[Металл | Дерево (или металл с деревом) | Бетон | Стеклопластик с подсветкой]
- **materials** (Материалы) kind=field req=true
- **purpose** (Назначение) kind=field req=true
- **img_dimensions** (Рисунок: Чертёж с размерами) kind=image req=true
- **img_foundation** (Рисунок: Схема фундамента) kind=image req=true

### product-texts (own/off)

- purpose / Назначение: variant «Информирование» own=false off=false
- installation / Установка: variant «Бетонирование опорных стоек» own=false off=false

### Черновик «что разумно проставить»

| Авто/координатор | Пользователь |
|------------------|--------------|
| warranty 12 (уже в defaults); serviceLife 10; joints bolts+welds; purpose из description + textChoice «Информирование»; materials из description (брус, лиственница); installationType CONCRETE_POSTS (бетонирование в description); blg.* facet — off (не ограждение/трибуна). | фото, габариты, вес, чертёж, схема фундамента |

---

## 3207 · Стелла (`6addd770c93bb8ea2a6e3969`)

### Showcase (снимок)

| Поле | Значение |
|------|----------|
| passportCategory | BLG |
| group / type | Благоустройство (оборудование невошедшее в другие группы) / Оборудование для благоустройства территории |
| purpose | — |
| description | — |
| installation | — |
| materialsText | — |
| materialsSpec | null |
| composition | (пусто) |
| facetValueIds | [] |
| warrantyMonths | — |
| serviceLifeYears | 10 |
| ageFrom / ageTo | — / — |
| maxUsers | — |
| fallHeight | — |
| isKit | — |
| installationTypeId | — |
| joints | ["bolts","welds"] |

**passportDefaults (целиком):**

```json
{
  "passportCategory": "BLG",
  "textChoices": {
    "6add909915d601111692a40f": "6adb5ab2edd024ba63d7f1a6"
  },
  "joints": [
    "bolts",
    "welds"
  ],
  "serviceLifeYears": 10
}
```

### passport-gaps

- **blg.fence** (Элемент ограждения) kind=facet req=false options=[Секция | Калитка | Стойка, столб]
- **blg.seats** (Мест) kind=facet req=false options=[до 5 | 10 | 15 | 20 | 25 и больше | Подъём (лестница) трибуны]
- **blg.seat** (Сиденье) kind=facet req=false options=[Пластик | Доска]
- **blg.rail** (Перила, спинка) kind=facet req=false options=[С перилами / со спинкой | Без перил / без спинки]
- **blg.material** (Материал) kind=facet req=false options=[Металл | Дерево (или металл с деревом) | Бетон | Стеклопластик с подсветкой]
- **height** (Габариты) kind=field req=true
- **weight** (Вес) kind=field req=true
- **materials** (Материалы) kind=field req=true
- **purpose** (Назначение) kind=field req=true
- **img_overview** (Фото изделия) kind=image req=true
- **installationTypeId** (Способ установки) kind=install req=true options=[Анкеры на фундамент | Бетонирование опор | На закладные детали | На покрытие | Ограждение на опорных стойках | Свободностоящий | Укладывается на основание (без крепления)]
- **img_dimensions** (Рисунок: Чертёж с размерами) kind=image req=true
- **warrantyMonths** (Гарантия, мес.) kind=field req=true

### product-texts (own/off)

- purpose / Назначение: variant «Прочее благоустройство» own=false off=false

### Черновик «что разумно проставить»

| Авто/координатор | Пользователь |
|------------------|--------------|
| warranty 12; serviceLife 10; joints; purpose «благоустройство/информирование» по типу стеллы — осторожно «Информирование» или «Прочее»; materials текст «металлоконструкция с деревянными элементами» если нет состава; installation бетонирование/анкеры по стойкам; blg.fence/seats/rail — off. | фото, габариты, вес, материалы уточнить, чертежи, способ установки если неочевиден |

---

## 3210 · Мостик (`6addd770c93bb8ea2a6e3972`)

### Showcase (снимок)

| Поле | Значение |
|------|----------|
| passportCategory | BLG |
| group / type | Благоустройство (оборудование невошедшее в другие группы) / Оборудование для благоустройства территории |
| purpose | — |
| description | — |
| installation | — |
| materialsText | — |
| materialsSpec | null |
| composition | (пусто) |
| facetValueIds | [] |
| warrantyMonths | — |
| serviceLifeYears | 10 |
| ageFrom / ageTo | — / — |
| maxUsers | — |
| fallHeight | — |
| isKit | — |
| installationTypeId | — |
| joints | ["bolts","welds"] |

**passportDefaults (целиком):**

```json
{
  "passportCategory": "BLG",
  "textChoices": {
    "6add909915d601111692a40f": "6adb5ab2edd024ba63d7f1a6"
  },
  "joints": [
    "bolts",
    "welds"
  ],
  "serviceLifeYears": 10
}
```

### passport-gaps

- **blg.fence** (Элемент ограждения) kind=facet req=false options=[Секция | Калитка | Стойка, столб]
- **blg.seats** (Мест) kind=facet req=false options=[до 5 | 10 | 15 | 20 | 25 и больше | Подъём (лестница) трибуны]
- **blg.seat** (Сиденье) kind=facet req=false options=[Пластик | Доска]
- **blg.rail** (Перила, спинка) kind=facet req=false options=[С перилами / со спинкой | Без перил / без спинки]
- **blg.material** (Материал) kind=facet req=false options=[Металл | Дерево (или металл с деревом) | Бетон | Стеклопластик с подсветкой]
- **height** (Габариты) kind=field req=true
- **weight** (Вес) kind=field req=true
- **materials** (Материалы) kind=field req=true
- **purpose** (Назначение) kind=field req=true
- **img_overview** (Фото изделия) kind=image req=true
- **installationTypeId** (Способ установки) kind=install req=true options=[Анкеры на фундамент | Бетонирование опор | На закладные детали | На покрытие | Ограждение на опорных стойках | Свободностоящий | Укладывается на основание (без крепления)]
- **img_dimensions** (Рисунок: Чертёж с размерами) kind=image req=true
- **warrantyMonths** (Гарантия, мес.) kind=field req=true

### product-texts (own/off)

- purpose / Назначение: variant «Прочее благоустройство» own=false off=false

### Черновик «что разумно проставить»

| Авто/координатор | Пользователь |
|------------------|--------------|
| warranty 12; serviceLife 10; joints; purpose «отдых» или прогулочный мост — «Прочее благоустройство»; installation бетонирование опор или анкеры; blg.* off кроме blg.material→дерево+металл если нужно. | фото, габариты, вес, материалы, чертежи |

---

## 3601 · Шахматный стол со стульями (`6addd772c93bb8ea2a6e39a2`)

### Showcase (снимок)

| Поле | Значение |
|------|----------|
| passportCategory | BLG |
| group / type | Столы / Оборудование для благоустройства территории |
| purpose | — |
| description | — |
| installation | — |
| materialsText | — |
| materialsSpec | null |
| composition | (пусто) |
| facetValueIds | [] |
| warrantyMonths | — |
| serviceLifeYears | 10 |
| ageFrom / ageTo | — / — |
| maxUsers | — |
| fallHeight | — |
| isKit | — |
| installationTypeId | — |
| joints | ["bolts","welds"] |

**passportDefaults (целиком):**

```json
{
  "passportCategory": "BLG",
  "elements": [
    "6adb17107920f392cb442fcf"
  ],
  "textChoices": {
    "6add909915d601111692a40f": "6adb5ab2edd024ba63d7f1a2"
  },
  "joints": [
    "bolts",
    "welds"
  ],
  "serviceLifeYears": 10
}
```

### passport-gaps

- **blg.fence** (Элемент ограждения) kind=facet req=false options=[Секция | Калитка | Стойка, столб]
- **blg.seats** (Мест) kind=facet req=false options=[до 5 | 10 | 15 | 20 | 25 и больше | Подъём (лестница) трибуны]
- **blg.seat** (Сиденье) kind=facet req=false options=[Пластик | Доска]
- **blg.rail** (Перила, спинка) kind=facet req=false options=[С перилами / со спинкой | Без перил / без спинки]
- **blg.material** (Материал) kind=facet req=false options=[Металл | Дерево (или металл с деревом) | Бетон | Стеклопластик с подсветкой]
- **height** (Габариты) kind=field req=true
- **weight** (Вес) kind=field req=true
- **materials** (Материалы) kind=field req=true
- **img_overview** (Фото изделия) kind=image req=true
- **installationTypeId** (Способ установки) kind=install req=true options=[Анкеры на фундамент | Бетонирование опор | На закладные детали | На покрытие | Ограждение на опорных стойках | Свободностоящий | Укладывается на основание (без крепления)]
- **img_dimensions** (Рисунок: Чертёж с размерами) kind=image req=true
- **warrantyMonths** (Гарантия, мес.) kind=field req=true

### product-texts (own/off)

- purpose / Назначение: variant «Отдых» own=false off=false

### Черновик «что разумно проставить»

| Авто/координатор | Пользователь |
|------------------|--------------|
| warranty 12; serviceLife 10; joints; textChoice «Отдых» уже в defaults; materials «металл, древесина»; installation FREESTANDING или LAID (стол на площадке) — уточнить; element в defaults — проверить комплект. | фото, габариты, вес, материалы, чертёж |

---

## 3206 · Качели (`6adaff432a8dad6034b14604`)

### Showcase (снимок)

| Поле | Значение |
|------|----------|
| passportCategory | BLG |
| group / type | Качели городские / Оборудование для благоустройства территории |
| purpose | — |
| description | Качели 2 (в дальнейшем именуемое «Изделие»), изготовленное из оцилиндрованного бревна ∅136 мм, бруса 100х100 мм, цепей и сидений из лиственницы с защитным маслом. Изделие устанавливается на подготовленной площадке методом бетонирования опорных стоек в грунт с соблюдением зон безопасности. Предназначено для комфортного качания и отдыха детей и взрослых на свежем воздухе. |
| installation | — |
| materialsText | Изготовлено из стального листа толщиной 6 мм. Окрашено порошковой краской методом запекания в заводских условиях. |
| materialsSpec | rows 1 |
| composition | rows 1:  |
| facetValueIds | [] |
| warrantyMonths | 12 |
| serviceLifeYears | 10 |
| ageFrom / ageTo | — / — |
| maxUsers | — |
| fallHeight | — |
| isKit | false |
| installationTypeId | Бетонирование опор (CONCRETE_POSTS) |
| joints | ["bolts","welds"] |

**passportDefaults (целиком):**

```json
{
  "passportCategory": "BLG",
  "installationTypeId": "6ada090c7536f8509feb4243",
  "isKit": false,
  "joints": [
    "bolts",
    "welds"
  ],
  "serviceLifeYears": 10,
  "warrantyMonths": 12
}
```

### passport-gaps

- **blg.fence** (Элемент ограждения) kind=facet req=false options=[Секция | Калитка | Стойка, столб]
- **blg.seats** (Мест) kind=facet req=false options=[до 5 | 10 | 15 | 20 | 25 и больше | Подъём (лестница) трибуны]
- **blg.seat** (Сиденье) kind=facet req=false options=[Пластик | Доска]
- **blg.rail** (Перила, спинка) kind=facet req=false options=[С перилами / со спинкой | Без перил / без спинки]
- **blg.material** (Материал) kind=facet req=false options=[Металл | Дерево (или металл с деревом) | Бетон | Стеклопластик с подсветкой]
- **purpose** (Назначение) kind=field req=true
- **img_dimensions** (Рисунок: Чертёж с размерами) kind=image req=true
- **img_foundation** (Рисунок: Схема фундамента) kind=image req=true
- **maxUsers** (Пользователей одновременно) kind=field req=true

### product-texts (own/off)

- care / Подвесы и осмотр городских качелей: variant «Текст» own=false off=false

### Черновик «что разумно проставить»

| Авто/координатор | Пользователь |
|------------------|--------------|
| warranty 12 есть; purpose+materials+установка **уже в description** — перенести в поля; maxUsers из gaps; installationType default бетонирование; joints есть; isKit false. | чертёж, схема фундамента, maxUsers если не из проекта |

---

## 3209 · Качели (`6addd770c93bb8ea2a6e396f`)

### Showcase (снимок)

| Поле | Значение |
|------|----------|
| passportCategory | DIO |
| group / type | Качели городские / Оборудование для благоустройства территории |
| purpose | — |
| description | — |
| installation | — |
| materialsText | — |
| materialsSpec | null |
| composition | (пусто) |
| facetValueIds | [] |
| warrantyMonths | — |
| serviceLifeYears | 10 |
| ageFrom / ageTo | — / — |
| maxUsers | — |
| fallHeight | — |
| isKit | — |
| installationTypeId | — |
| joints | ["bolts","welds"] |

**passportDefaults (целиком):**

```json
{
  "passportCategory": "DIO",
  "elements": [
    "6ada090c7536f8509feb4225"
  ],
  "textChoices": {
    "6add909915d601111692a40f": "6adb5ab2edd024ba63d7f1a7"
  },
  "joints": [
    "bolts",
    "welds"
  ],
  "serviceLifeYears": 10
}
```

### passport-gaps

- **dio.age** (Возраст детей) kind=facet req=false options=[до 3 лет | 3–7 лет | 7–12 лет | 3–12 лет]
- **dio.seats** (Мест) kind=facet req=false options=[Одно место | Два места | Три и больше]
- **dio.material** (Материал) kind=facet req=false options=[Металл | Дерево (или металл с деревом) | Стеклопластик]
- **height** (Габариты) kind=field req=true
- **weight** (Вес) kind=field req=true
- **materials** (Материалы) kind=field req=true
- **img_overview** (Фото изделия) kind=image req=true
- **installationTypeId** (Способ установки) kind=install req=true default=Бетонирование опор options=[Анкеры на фундамент | Бетонирование опор | На закладные детали | На покрытие | Ограждение на опорных стойках | Свободностоящий | Укладывается на основание (без крепления)]
- **ageFrom** (Возраст от) kind=field req=true
- **ageTo** (Возраст до) kind=field req=true
- **maxUsers** (Пользователей одновременно) kind=field req=true
- **fallHeight** (Высота свободного падения) kind=field req=true
- **img_dimensions** (Рисунок: Чертёж с размерами) kind=image req=true
- **img_safety** (Рисунок: Зона безопасности) kind=image req=true
- **img_foundation** (Рисунок: Схема фундамента) kind=image req=true
- **img_holes** (Рисунок: Разметка ям под опоры) kind=image req=true
- **warrantyMonths** (Гарантия, мес.) kind=field req=true

### product-texts (own/off)

- purpose / Назначение: variant «Игровое» own=false off=false

### Черновик «что разумно проставить»

| Авто/координатор | Пользователь |
|------------------|--------------|
| **DIO осторожно:** default install «Бетонирование опор»; warranty 12; serviceLife 10; joints; age 3–12 или ageFrom 3 ageTo 12 **только с согласованием**; maxUsers 1–2 **не угадывать без проекта**; fallHeight **только пользователь**; dio.seats→«Два места» если двойные; dio.material→дерево; materials текст по аналогии 3206; blg.* не трогать. | все габариты, вес, фото, 4+ рисунка DIO, fallHeight, точный возраст/пользователи |

---

## 3211 · Деревянный гамак (`6addd770c93bb8ea2a6e3975`)

### Showcase (снимок)

| Поле | Значение |
|------|----------|
| passportCategory | BLG |
| group / type | Благоустройство (оборудование невошедшее в другие группы) / Оборудование для благоустройства территории |
| purpose | — |
| description | — |
| installation | — |
| materialsText | — |
| materialsSpec | null |
| composition | (пусто) |
| facetValueIds | [] |
| warrantyMonths | — |
| serviceLifeYears | 10 |
| ageFrom / ageTo | — / — |
| maxUsers | — |
| fallHeight | — |
| isKit | — |
| installationTypeId | — |
| joints | ["bolts","welds"] |

**passportDefaults (целиком):**

```json
{
  "passportCategory": "BLG",
  "textChoices": {
    "6add909915d601111692a40f": "6adb5ab2edd024ba63d7f1a2"
  },
  "joints": [
    "bolts",
    "welds"
  ],
  "serviceLifeYears": 10
}
```

### passport-gaps

- **blg.fence** (Элемент ограждения) kind=facet req=false options=[Секция | Калитка | Стойка, столб]
- **blg.seats** (Мест) kind=facet req=false options=[до 5 | 10 | 15 | 20 | 25 и больше | Подъём (лестница) трибуны]
- **blg.seat** (Сиденье) kind=facet req=false options=[Пластик | Доска]
- **blg.rail** (Перила, спинка) kind=facet req=false options=[С перилами / со спинкой | Без перил / без спинки]
- **blg.material** (Материал) kind=facet req=false suggest=Дерево (или металл с деревом) options=[Металл | Дерево (или металл с деревом) | Бетон | Стеклопластик с подсветкой]
- **height** (Габариты) kind=field req=true
- **weight** (Вес) kind=field req=true
- **materials** (Материалы) kind=field req=true
- **purpose** (Назначение) kind=field req=true
- **img_overview** (Фото изделия) kind=image req=true
- **installationTypeId** (Способ установки) kind=install req=true options=[Анкеры на фундамент | Бетонирование опор | На закладные детали | На покрытие | Ограждение на опорных стойках | Свободностоящий | Укладывается на основание (без крепления)]
- **img_dimensions** (Рисунок: Чертёж с размерами) kind=image req=true
- **warrantyMonths** (Гарантия, мес.) kind=field req=true

### product-texts (own/off)

- purpose / Назначение: variant «Отдых» own=false off=false

### Черновик «что разумно проставить»

| Авто/координатор | Пользователь |
|------------------|--------------|
| warranty 12; serviceLife 10; joints; purpose «Отдых»; materials дерево; installation бетонирование/анкеры подвесов; blg.* off. | фото, габариты, вес, чертежи |

---

## 3212 · Шезлонг (`6addd770c93bb8ea2a6e3978`)

### Showcase (снимок)

| Поле | Значение |
|------|----------|
| passportCategory | BLG |
| group / type | Благоустройство (оборудование невошедшее в другие группы) / Оборудование для благоустройства территории |
| purpose | — |
| description | — |
| installation | — |
| materialsText | — |
| materialsSpec | null |
| composition | (пусто) |
| facetValueIds | [] |
| warrantyMonths | — |
| serviceLifeYears | 10 |
| ageFrom / ageTo | — / — |
| maxUsers | — |
| fallHeight | — |
| isKit | — |
| installationTypeId | — |
| joints | ["bolts","welds"] |

**passportDefaults (целиком):**

```json
{
  "passportCategory": "BLG",
  "textChoices": {
    "6add909915d601111692a40f": "6adb5ab2edd024ba63d7f1a2"
  },
  "joints": [
    "bolts",
    "welds"
  ],
  "serviceLifeYears": 10
}
```

### passport-gaps

- **blg.fence** (Элемент ограждения) kind=facet req=false options=[Секция | Калитка | Стойка, столб]
- **blg.seats** (Мест) kind=facet req=false options=[до 5 | 10 | 15 | 20 | 25 и больше | Подъём (лестница) трибуны]
- **blg.seat** (Сиденье) kind=facet req=false options=[Пластик | Доска]
- **blg.rail** (Перила, спинка) kind=facet req=false options=[С перилами / со спинкой | Без перил / без спинки]
- **blg.material** (Материал) kind=facet req=false options=[Металл | Дерево (или металл с деревом) | Бетон | Стеклопластик с подсветкой]
- **height** (Габариты) kind=field req=true
- **weight** (Вес) kind=field req=true
- **materials** (Материалы) kind=field req=true
- **purpose** (Назначение) kind=field req=true
- **img_overview** (Фото изделия) kind=image req=true
- **installationTypeId** (Способ установки) kind=install req=true options=[Анкеры на фундамент | Бетонирование опор | На закладные детали | На покрытие | Ограждение на опорных стойках | Свободностоящий | Укладывается на основание (без крепления)]
- **img_dimensions** (Рисунок: Чертёж с размерами) kind=image req=true
- **warrantyMonths** (Гарантия, мес.) kind=field req=true

### product-texts (own/off)

- purpose / Назначение: variant «Отдых» own=false off=false

### Черновик «что разумно проставить»

| Авто/координатор | Пользователь |
|------------------|--------------|
| warranty 12; serviceLife 10; joints; purpose «Отдых»; materials металл+дерево; installation свободностоящий или бетонирование; blg.seat/rail — «с перилами» если есть спинка. | фото, габариты, вес, материалы, чертежи |

---

## 3218 · Прочие МАФы 4 1800х2000х1400 (смета) (`6ae440f6f08b6a47889f4859`)

### Showcase (снимок)

| Поле | Значение |
|------|----------|
| passportCategory | BLG |
| group / type | Благоустройство (оборудование невошедшее в другие группы) / Оборудование для благоустройства территории |
| purpose | — |
| description | — |
| installation | — |
| materialsText | — |
| materialsSpec | null |
| composition | (пусто) |
| facetValueIds | [] |
| warrantyMonths | — |
| serviceLifeYears | 10 |
| ageFrom / ageTo | — / — |
| maxUsers | — |
| fallHeight | — |
| isKit | — |
| installationTypeId | — |
| joints | ["bolts","welds"] |

**passportDefaults (целиком):**

```json
{
  "passportCategory": "BLG",
  "textChoices": {
    "6add909915d601111692a40f": "6adb5ab2edd024ba63d7f1a6"
  },
  "joints": [
    "bolts",
    "welds"
  ],
  "serviceLifeYears": 10
}
```

### passport-gaps

- **blg.fence** (Элемент ограждения) kind=facet req=false options=[Секция | Калитка | Стойка, столб]
- **blg.seats** (Мест) kind=facet req=false options=[до 5 | 10 | 15 | 20 | 25 и больше | Подъём (лестница) трибуны]
- **blg.seat** (Сиденье) kind=facet req=false options=[Пластик | Доска]
- **blg.rail** (Перила, спинка) kind=facet req=false options=[С перилами / со спинкой | Без перил / без спинки]
- **blg.material** (Материал) kind=facet req=false options=[Металл | Дерево (или металл с деревом) | Бетон | Стеклопластик с подсветкой]
- **height** (Габариты) kind=field req=true
- **weight** (Вес) kind=field req=true
- **materials** (Материалы) kind=field req=true
- **purpose** (Назначение) kind=field req=true
- **img_overview** (Фото изделия) kind=image req=true
- **installationTypeId** (Способ установки) kind=install req=true options=[Анкеры на фундамент | Бетонирование опор | На закладные детали | На покрытие | Ограждение на опорных стойках | Свободностоящий | Укладывается на основание (без крепления)]
- **img_dimensions** (Рисунок: Чертёж с размерами) kind=image req=true
- **warrantyMonths** (Гарантия, мес.) kind=field req=true

### product-texts (own/off)

- purpose / Назначение: variant «Прочее благоустройство» own=false off=false

### Черновик «что разумно проставить»

| Авто/координатор | Пользователь |
|------------------|--------------|
| warranty 12; serviceLife 10; joints; purpose «Прочее благоустройство»; materials по названию МАФ — запросить у проектировщика; installation по конструкции. | всё по размерам из названия — всё равно подтвердить фото/вес/чертежи |

---

## 3215 · Экотропа 120 м.п. (`6addd770c93bb8ea2a6e3981`)

### Showcase (снимок)

| Поле | Значение |
|------|----------|
| passportCategory | BLG |
| group / type | Благоустройство (оборудование невошедшее в другие группы) / Оборудование для благоустройства территории |
| purpose | — |
| description | — |
| installation | — |
| materialsText | — |
| materialsSpec | null |
| composition | (пусто) |
| facetValueIds | [] |
| warrantyMonths | — |
| serviceLifeYears | 10 |
| ageFrom / ageTo | — / — |
| maxUsers | — |
| fallHeight | — |
| isKit | — |
| installationTypeId | — |
| joints | ["bolts","welds"] |

**passportDefaults (целиком):**

```json
{
  "passportCategory": "BLG",
  "textChoices": {
    "6add909915d601111692a40f": "6adb5ab2edd024ba63d7f1a6"
  },
  "joints": [
    "bolts",
    "welds"
  ],
  "serviceLifeYears": 10
}
```

### passport-gaps

- **blg.fence** (Элемент ограждения) kind=facet req=false options=[Секция | Калитка | Стойка, столб]
- **blg.seats** (Мест) kind=facet req=false options=[до 5 | 10 | 15 | 20 | 25 и больше | Подъём (лестница) трибуны]
- **blg.seat** (Сиденье) kind=facet req=false options=[Пластик | Доска]
- **blg.rail** (Перила, спинка) kind=facet req=false options=[С перилами / со спинкой | Без перил / без спинки]
- **blg.material** (Материал) kind=facet req=false options=[Металл | Дерево (или металл с деревом) | Бетон | Стеклопластик с подсветкой]
- **height** (Габариты) kind=field req=true
- **weight** (Вес) kind=field req=true
- **materials** (Материалы) kind=field req=true
- **purpose** (Назначение) kind=field req=true
- **img_overview** (Фото изделия) kind=image req=true
- **installationTypeId** (Способ установки) kind=install req=true options=[Анкеры на фундамент | Бетонирование опор | На закладные детали | На покрытие | Ограждение на опорных стойках | Свободностоящий | Укладывается на основание (без крепления)]
- **img_dimensions** (Рисунок: Чертёж с размерами) kind=image req=true
- **warrantyMonths** (Гарантия, мес.) kind=field req=true

### product-texts (own/off)

- purpose / Назначение: variant «Прочее благоустройство» own=false off=false

### Черновик «что разумно проставить»

| Авто/координатор | Пользователь |
|------------------|--------------|
| warranty 12; serviceLife 10; joints; purpose «озеленение/благоустройство»; materials покрытие экотропы (щебень, геотекстиль…) — **только если есть в заявках/составе**, иначе пользователь; installation укладка на основание. | длина 120 м.п., габариты сечения, вес, фото, чертежи |

---

## Сводка черновиков по sku

| sku | что проставить без фото/габаритов | оставить пользователю |
|-----|-----------------------------------|------------------------|
| 3905 | warranty 12 (уже в defaults); serviceLife 10; joints bolts+welds; purpose из description + textChoice «Информирование»; … | фото, габариты, вес, чертёж, схема фундамента |
| 3207 | warranty 12; serviceLife 10; joints; purpose «благоустройство/информирование» по типу стеллы — осторожно «Информирование… | фото, габариты, вес, материалы уточнить, чертежи, способ установки если неочевиден |
| 3210 | warranty 12; serviceLife 10; joints; purpose «отдых» или прогулочный мост — «Прочее благоустройство»; installation бетон… | фото, габариты, вес, материалы, чертежи |
| 3601 | warranty 12; serviceLife 10; joints; textChoice «Отдых» уже в defaults; materials «металл, древесина»; installation FREE… | фото, габариты, вес, материалы, чертёж |
| 3206 | warranty 12 есть; purpose+materials+установка **уже в description** — перенести в поля; maxUsers из gaps; installationTy… | чертёж, схема фундамента, maxUsers если не из проекта |
| 3209 | **DIO осторожно:** default install «Бетонирование опор»; warranty 12; serviceLife 10; joints; age 3–12 или ageFrom 3 age… | все габариты, вес, фото, 4+ рисунка DIO, fallHeight, точный возраст/пользователи |
| 3211 | warranty 12; serviceLife 10; joints; purpose «Отдых»; materials дерево; installation бетонирование/анкеры подвесов; blg.… | фото, габариты, вес, чертежи |
| 3212 | warranty 12; serviceLife 10; joints; purpose «Отдых»; materials металл+дерево; installation свободностоящий или бетониро… | фото, габариты, вес, материалы, чертежи |
| 3218 | warranty 12; serviceLife 10; joints; purpose «Прочее благоустройство»; materials по названию МАФ — запросить у проектиро… | всё по размерам из названия — всё равно подтвердить фото/вес/чертежи |
| 3215 | warranty 12; serviceLife 10; joints; purpose «озеленение/благоустройство»; materials покрытие экотропы (щебень, геотекст… | длина 120 м.п., габариты сечения, вес, фото, чертежи |
