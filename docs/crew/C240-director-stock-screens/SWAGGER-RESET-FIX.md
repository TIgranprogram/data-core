# Команда resetStockViews — Swagger schema

Исправлен только декоратор UpdateRoleDto: `type:Boolean, allOf:[{type:'boolean',enum:[true]}]`, без верхнего enum. Установленный Swagger enum.utils.getEnumType выбирает string при строковом enum, иначе number; поэтому прежний enum[true] переопределял Boolean неверным number.

Настоящий SchemaObjectFactory удаляет верхний type при allOf; ожидаемая схема поля — optional `allOf:[{type:'boolean',enum:[true]}]` с описанием, без верхнего type/enum. Это точное ограничение boolean и единственного значения true, а не снятие ограничения. Runtime ValidateIf/Equals(true)/взаимоисключение stockViews не менялись.

Регрессия `modules/role/stock-views.swagger.spec.ts` строит схему реальным SchemaObjectFactory/ModelPropertiesAccessor/SwaggerTypesMapper, проверяет точный allOf и optional, отсутствие команды в CreateRoleDto. Автор Jest/tsc не запускал по координации с общим QA; адресный и полный прогоны выполняет QA отдельно. diff--check PASS.

Два файла frozen; SHA переданы координатору. Не коммитил, OpenAPI не регенерировал, прод не трогал.
