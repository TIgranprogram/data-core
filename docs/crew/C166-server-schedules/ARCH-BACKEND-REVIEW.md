# C166 — независимая приёмка backend

Вердикт архитектора: PASS только backend, frozen890dece6. P0/P1 и подтверждённых P2 не найдено. Отчёт передан координатору текстом: файловая песочница роли не разрешила записать его в новую worktree; исходный D: не менялся. Координатор сохраняет утверждённый результат без повторного ревью.

- switch.service.ts:167: CAS настроек revision/role/mode/idle, legacy env до PUT.
- :201: один CAS job+слот/runtime, защита от двух процессов.
- switch-outbox.ts:37 и service:430: same-ID после рестарта, lease, атомарная публикация без замены чужого файла, expiry.
- schedule.rules.ts:59: Москва, ISO-дни, 30-минутное окно, постоянный курсор и ограниченный безопасный retry.
- schedule.rules.ts:137: ручные scope data/both обновляют результат, не сдвигая плановые курсоры.
- service:480: POST start свежие health/identity/role/version/copy age/domain.
- switch.rules.ts:136: promote/VPS при неопределённости остаётся readonly до подтверждения моста.
- app.module.ts:138: заголовок секрета моста скрыт из HTTP-журналов.

Собственные проверки роли: 36/36 unit PASS, cycles0. 10e2e/tsc/lint — подтверждение BACKEND-REPORT, повторно не запускались. Host/UI/live/combined QA этим вердиктом не закрыты.
