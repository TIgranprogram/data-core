# План заполнения паспортов заказа 11-26 (прод)

**Разрешение пользователя:** «заполни» / «что разумно можешь заполнить» (2026-11-11).  
**Не трогать:** фото, length/width/height, weightKg, чертежи/схемы.  
**Фирма выпуска (позже):** СИЮ `6ad52bec863df73f344ea489`.  
**Не выпускать номера**, пока пользователь не дозаполнит фото/габариты — только шаблоны изделий.

Установка ids: CONCRETE_POSTS=`6ada090c7536f8509feb4243`, FREESTANDING=`6ada090c7536f8509feb4246`, LAID=`6af1cc81bde492a73d513db8`, ANCHORS=`6ada090c7536f8509feb4244`.  
Purpose phrase ids: Информирование=`6adb5ab2edd024ba63d7f1a4`, Отдых=`6adb5ab2edd024ba63d7f1a2`, Прочее=`6adb5ab2edd024ba63d7f1a6`, Озеленение=`6adb5ab2edd024ba63d7f1a3`, Игровое DIO=`6adb5ab2edd024ba63d7f1a7`.  
Installation phrase: Бетонирование=`6adb5ab2edd024ba63d7f1b2`, Свободная=`6adb5ab2edd024ba63d7f1b6`, DIO бетонирование=`6adb5ab2edd024ba63d7f1b7`.  
Раздел purpose/install в textChoices: purpose root=`6add909915d601111692a40f`, install root=`6add909915d601111692a410` (как у 3905; если у DIO другие — взять из product-texts).

## По каждому sku

### 3905 указатели `6adaff432a8dad6034b14603`
- PATCH purpose: «Предназначено для навигации и указания направлений движения посетителей в местах общественного пользования.»
- PATCH installation: «Устанавливается методом прямого бетонирования опорного столба в грунт.»
- materialsSpec: подобрать из `passportMaterials` дерево/брус/лиственница (1–2 строки) по поиску; если нет точного — дерево + масло как покрытие если есть coating.
- defaults: уже warranty 12 / install CONCRETE — не ломать; facet blg.material → значение «Дерево…» если известен id.

### 3207 стелла `6addd770c93bb8ea2a6e3969`
- purpose: «Информационная стелла / указатель для благоустройства территории.»
- warranty 12; install CONCRETE_POSTS; textChoices purpose=Информирование + install=Бетонирование.
- materialsSpec: металл + дерево (по справочнику).

### 3210 мостик `6addd770c93bb8ea2a6e3972`
- purpose: «Пешеходный мостик для благоустройства и прогулочных зон.»
- warranty 12; install CONCRETE_POSTS или ANCHORS; purpose=Прочее; materials металл+дерево.

### 3601 шахматный стол `6addd772c93bb8ea2a6e39a2`
- purpose: «Предназначено для отдыха и настольных игр на открытом воздухе.»
- warranty 12; install FREESTANDING; purpose=Отдых; materials металл+дерево.

### 3206 качели `6adaff432a8dad6034b14604`
- purpose из description: «Предназначено для комфортного качания и отдыха детей и взрослых на свежем воздухе.»
- installation из description (бетонирование).
- materialsSpec уже есть — не затирать; сверить materialsText; maxUsers не ставить без данных.
- defaults уже ок.

### 3209 качели DIO `6addd770c93bb8ea2a6e396f`
- **осторожно:** warranty 12; install CONCRETE_POSTS; purpose phrase Игровое; textChoices DIO.
- ageFrom/ageTo / maxUsers / fallHeight — **не угадывать**.
- materialsSpec: дерево (+металл если есть в справочнике).

### 3211 гамак `6addd770c93bb8ea2a6e3975`
- purpose: «Деревянный гамак для отдыха на открытом воздухе.»
- warranty 12; install CONCRETE_POSTS или ANCHORS; purpose=Отдых; materials дерево.

### 3212 шезлонг `6addd770c93bb8ea2a6e3978`
- purpose: «Шезлонг для отдыха на открытом воздухе.»
- warranty 12; install FREESTANDING; purpose=Отдых; materials металл+дерево.

### 3218 прочие МАФ `6ae440f6f08b6a47889f4859`
- purpose: «Элемент благоустройства территории (МАФ).»
- warranty 12; purpose=Прочее; install не угадывать если неочевидно — CONCRETE_POSTS как типичный для МАФ только если в названии опоры; иначе пропустить install.
- materials — только если найдены в справочнике «дерево»/«металл»; иначе пропуск.

### 3215 экотропа `6addd770c93bb8ea2a6e3981`
- purpose: «Экотропа для прогулок и благоустройства территории.»
- warranty 12; install LAID; purpose=Озеленение; materials — только при наличии в справочнике (дерево/настил); иначе пропуск materials.

## Порядок API
1. GET `/api/dicts/passportMaterials?limit=200` (или search) — карта имён→id.
2. Для каждого id: PATCH `/api/showcase/:id` { purpose, installation? } и при наличии materialsSpec.
3. PUT `/api/showcase/:id/passport-defaults` — merge: warrantyMonths, serviceLifeYears, joints, installationTypeId, textChoices.
4. GET passport-gaps повторно — записать что закрылось / что осталось пользователю.
5. Итог: `ORDER-11-26-FILL-APPLY.md`. Выпуск паспортов на incomeId — не делать в этом шаге.
