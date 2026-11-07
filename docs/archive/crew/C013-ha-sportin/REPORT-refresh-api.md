статус: готово
сделано: POST /control/switch/refresh ✅ · kind=refresh в мосте ✅ · canRefresh ✅ · rules/dto/specs ✅ · админка ➖
файлы: switch.service.ts:refreshPeer 284, canRefresh 226; switch.controller.ts:43; switch.rules.ts:100; specs; e2e; switch-watch.sh:do_refresh 341; docs/MAP.md
проверки: tsc 0; jest switch 25/25; bash -n 0. e2e не гонялся. openapi не обновлён.
мост: preflight без VPS → photos_pre → readonly → dump → restore (сосед standby+normal, job:null) → photos → code → verify → finish (mode normal). Домен не трогается.
риски: на серверах не прогонялся; сборка может упереться в 10 минут readonly; rsync --delete только в backend/ и deploy/.
нужно от frontend: кнопка «Обновить» → POST {confirm:true}; canRefresh и job.direction=refresh; обе кнопки disabled, пока идёт работа.
карта обновлена. коммит: —
