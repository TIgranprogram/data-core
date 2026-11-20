# C164 — готовность изолированной копии

Проверка20.11.2026,03:48:17UTC. **READY_EXISTING_COPY**: одна read-only readiness-проверка, без входа, пересборки и импорта. Это не приёмка нового runtimeC164.

| Проверка | Фактический результат |
|--|--|
|Docker|Доступен, Server29.9.3, exit0; запуск через nativeNode, безGitBash|
|Ownedrun|`f9f4ea383bd66a4c5d81e48b`, initialized=true, ownership labels проверены штатнымassertOwned|
|Project|`dc-f9f4ea383bd66a4c5d81e48b-night`, owner`datacore-night-v1`|
|API/шлюз|`http://localhost:3198`, единственный публичный GET`/api/health/ready`→200/ok|
|Mongoport|27158; отдельная копия`datacore-f9f4ea383bd66a4c5d81e48b-night`|
|Отдельнаяe2eБД|`datacore-test-f9f4ea383bd66a4c5d81e48b-night`; данные/коллекции не читались и не менялись|
|Сервисы|backend,proxy,mongo работают; одноразовыйkeyfile завершён, его не запускали|
|Тома|mongo-data,mongo-config,secrets,uploads принадлежат именно этомуproject; содержимое не открывалось|
|Источник копии|`datacore-2026-11-18_031040.tgz`, restoredAt`2026-11-19T13:06:45.962Z`|

Последняя сборка по публичнойdevelopmentmetadata: HEAD`0debbc3ee94bc6ce1bea0e6d7c43cf54c0e31d24`, dirty=true, builtAt`2026-11-19T19:50:05.985Z` (старыйC163+C165). ТекущийcheckoutHEAD`daacc7bc111c2b1b9c2cb924af7f6bbc09f750e9` уже отличается. PWA/admin смонтированыread-only из рабочейкопии, поэтому текущий интерфейс и старыйcompiledbackend могут различаться; проверку новогоC164на этой смеси не объявляемPASS.

Зафиксированные границы для будущего backend-onlyrefresh:

- backendID`fa3b0dcdd93fd91095b53eabaa302b46848b82f86f8d25e293810cfd1d4810d5`, StartedAt`2026-11-19T19:50:03.014250588Z`.
- MongoID`dec559c4d2c953ea05aef449e54b8527b7e55e094925268e953a3deb5293c42a`, StartedAt`2026-11-19T13:06:21.678529654Z`.
- proxyID`de56d6b70a8a287a3c44c7dfc497554f925f954b066ad1dd9688e7d4a1c3fc3d`, StartedAt`2026-11-19T13:14:19.94238077Z`.

Продолжение только послеrootfreeze: новый проверенный backend-onlyrunner с точным новымsourceHEAD; единственная реальнаяcomposemutation`up -d --no-deps --build backend`, Mongo/proxyID+StartedAt сохраняются, uploadsvolume сохраняется. СтарыйpinnedC165runner не использовать. ОбычныйstandRefresh сейчас содержитUPMongo/proxy, поэтому его напрямую в параллельномQAокне не запускать. Никакихreset/reseed/restore/down/volumeопераций и измененийDcheckout.

QAразделяетHOSTNode/Jest→27158/exacttestDb и браузернуюкопию; accessв этом прогоне ни одной тестовой/производственнойБД не открывал. Послеfreezeиhealth — отдельныйrootreviewсценария и только `api.sh stand BROWSER` дляowned3198, сессияstdin. Нужные2локальныхstand/cachehunkapi.sh готовятся тогда и очищаются после приёмки, сейчасapi.shне менялся. ProdAPI/авторизация/финансовые и складские записи0.

Публичное доказательство безENV/секретов: `tools/logs/c164-readiness-once-result.json`. Ошибкаrootdcstart`GitBash NtCreateDirectoryObject` этим прогоном не воспроизведена: readiness выполнен безGitBash, Dockerи3198доступны. Причина ошибкиshell/sandbox отдельно не исправлялась. Повторных readiness-прогонов не было. **NO_ACTIVE_WRITE**.
