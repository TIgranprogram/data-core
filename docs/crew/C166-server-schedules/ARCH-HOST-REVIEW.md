# C166 — независимая приёмка хостовой части

Вердикт: можно — static PASS замороженного host scope; оба найденных P1 закрыты адресным вторым проходом.
Проверено: switch-watch.sh, release-artifact.sh, standby-release.sh, release.sh; соответствующие stub/release tests. Backend повторно не проверялся.
🟢 release.sh:114–125 и :59–67 — failed rollback/disconnect удерживает durable gate и прежний cron-flock; явный rollback освобождает их только после подтверждённого успеха.
🟢 switch-watch.sh:334–348 — failed peer finish сохраняет phase=switched/current и target gate до подтверждения; recovery не повторяет перенос/переключение.
🟢 switch-watch.sh:141–154 — peer terminal 409 подтверждает тот же job/done/main/normal; :117–125,525–528 source terminal 409 проверяет тот же job/state/role/mode. Чужой ответ не удаляет current.
🟢 Неизменяемый принятый архив и SHA/pin, первый upgrade через старый flock; stage build без второго backend; runtime local/config source; snapshot→apply→health/version/counts→rollback/quarantine; нет stop Mongo/CRM.
🟢 preflight.sh:70–80 — исправленный завершённый grep condition и fail-closed syntax/release/bridge/standby checks; process-gate один. Повреждённая промежуточная вставка обнаружена и исправлена до приёмки.
Freeze SHA проверены: switch-watch 332ffb5743e08dc8b615e0231c2caf18875044c892d1dc82d699296efc20d40f; release e3805943d7af94f93930e59ffd2c3f2027d4ffc61d4397a2ddf85754d92e0457.
Изолированные harness: worker 47/47 PASS по сообщению координатора; независимый coordinator 47/47 PASS (tools/logs/c166-coordinator-host-*). Это не собственные прогоны архитектора.
Собственные shell-прогоны SKIP среды: Git Bash NtCreateDirectoryObject 0xC0000022 до запуска сценариев. Прочитаны отрицательные fixtures rollbackfail/disconnect/manualfail, peer503/foreign409/same409 и source terminal409.
Не проверено: живые SSH/Docker/VPS, production failover/failback, CRM/auth/шифрование и UI. Эти границы не объявлялись готовыми; новый preflight bash-n отдельно подтверждает координатор.
Коммит: C166 frozen рабочий diff; карта/общие журналы — координатору. Код не изменялся, только этот отчёт.
