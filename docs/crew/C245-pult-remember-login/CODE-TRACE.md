# C245 — почему Пульт не запоминает вход

23.11.2026. Только исходный код и исторические отчёты. Реальные .state/settings/session/credentials, ключи, пароли и JWT не читались; логинов, API-проб и изменений кода нет.

## Основная причина

`pult/document-intake.mjs:136` canRemember разрешает сохранение только при наличии Windows secureSession И localBase(apiBase,'/api'). Рабочий https://kppdf-crm.ru/db/api намеренно исключён: login307 посылает remember:false, saveSession168 ничего не сохраняет. Это не предположение/новая регрессия: C228/REPORT прямо говорит «Для рабочего сайта остаётся сессия в памяти», тест document-intake.test.mjs117–181 требует prodremember:false и отсутствия sessionFile. C233/REPORT35 уже отмечал потерю рабочего входа после автообновления Пульта.

## Цепочка

1. `pult/server.mjs:149/222` передаёт stateDir (по умолчанию <checkout>/pult/.state). `document-intake.mjs:104–105`: настройки document-intake.json, защищённая сессия document-intake-session.json. Это не browser localStorage и не папка входящих; разные checkout/ПК имеют разные состояния.
2. `serviceSettings:30–38` принимает exact production или только loopback HTTP /api. localBase24 нормализует localhost к127.0.0.1, порт в число, один завершающий slash. Иные порты/IPv6/рабочий↔локальный — иная identity. Произвольные HTTPS, credentials/query/hash и иной порт рабочего сайта запрещены.
3. `protectSession:53–69`: Windows DPAPI CurrentUser, вход/выход через stdin/base64; на других ОС secureSession=null. `saveSession168–179` хранит только sealed refresh JWT и binding apiBase/sub/version/role/orgId. Пароль и access-токен не записываются. jsonAtomic обеспечивает завершённую запись.
4. `loadSavedSession154–164`: decrypt, exact apiBase, корректный JWT, sub/version, rem:true, exp>now; невалидное/просроченное/нерасшифрованное очищается. ENOENT спокойно означает отсутствие сохранённого входа.
5. `reconnect205–222` выполняется перед каждым route кроме logout (route433–434). Единственный restoring Promise; POSTauth/refresh с Bearer refresh, без браузерной cookie jar. Ответный access и новый refreshCookie обязательны; проверяются sub/version/role/orgId/rem/expiry. Успех заменяет пару и атомарно пересохраняет refresh. AUTH401/403 стирает запись; временный сбой сохраняет запись и retry через15s.
6. `tokenProvider336–369` за60s до истечения access делает один совместный refresh для параллельных запросов. При отсутствии/истечении refresh — AUTH. Временная ошибка при remember:false стирает auth (348), поэтому рабочий вход может потеряться и внутри открытого Пульта при сетевом сбое. При remember:true сохраняется возможность reconnect; abort не стирает вход.
7. `save232` при изменении apiBase вызывает forgetAuth: одна сохранённая активная сессия, не карта всех сайтов. `logout486` удаляет запись. Binding operation дополнительно включает root/apiBase/auth-объект: старый token provider не применяется после смены адреса/аккаунта/папки.
8. `pult/server.mjs:28–48/477–478` отпечаток pult/UI/intake-кода вызывает автоматический respawn, если нет активной работы. `main592` обычного окна завершает процесс по idle (по умолчанию15s в149); простой F5 без перезапуска процесса сохраняет память. Закрытие/автоперезапуск гарантированно теряет рабочую in-memory сессию при текущей политике.
9. `pult/ui/document-intake.js309–315`: remembered показывает «запомнил вход в тестовую копию»/«восстановим…копию». После поддержки prod эти тексты тоже надо сделать корректными для выбранного сайта. Username отдельно в settings не сохраняется; при успешном восстановлении форма скрыта и это не требуется.

Backend auth уже поддерживает remember:true:90дней (auth.service57/300–307), access обычно15мин. remember:false — сессионная cookie и refresh обычно30дней. Node-Пульт берёт Set-Cookie вручную и посылает refresh Bearer; browser Cookie Path/SameSite не являются причиной текущего ограничения.

## Границы и риски

- Основное исправление — распространить существующий защищённый механизм на exact trusted production, сохранив local allowlist и fail-closed без DPAPI; не вводить хранение пароля/открытых токенов или произвольный внешний адрес.
- После обновления потребуется один новый вход: прежний prodrefresh имеет rem:false и не подходит для сохраняемой сессии. Logout/site-change/account-version/expiry/revocation продолжают принудительно закрывать вход.
- Сбой DPAPI/записи сейчас проглатывается saveSession178: текущий вход работает, rememberedOnDisk остаётся false. Это отдельный риск честности сообщения, не доказанный сбой на данном ПК. Запрещено считать вход сохранённым до успешного sealed-write.
- Новый owned-стенд/смена JWT-секрета или отзыв refresh закономерно могут потребовать вход заново; не обходить401/403 ради «запоминания». DPAPI не переносится на другой Windows-профиль/ПК.
- Если жалоба относится к локальной копии без закрытия/смены процесса, нужна только последовательность действий: после закрытия/обновления, после смены рабочего/тестового адреса либо прямо в разборе. Для рабочего сайта после перезапуска причина уже доказана кодом, уточнение не блокирует этот scope.

## Существующие проверки

`pult/test/document-intake.test.mjs117–181`: реальный WindowsDPAPI на синтетических данных, restart/outage/recovery/logout/revocation; последний assert явно запрещает prodpersist. `412+`: proactive refresh дважды, single-flight, account/site change, revoked/unknown/wrong-account/no-cookie, abort сохраняет. `266+`: URL allowlist/Host-Origin/revision. Изменить prod-expectation следует как новое требование владельца, сохранив негативные проверки, а не удалив защиту. Новых тестов/прогонов этой разведкой не выполнялось.