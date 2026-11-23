# Run05 — подготовлен, не запущен
PARTIAL | Ожидается явный сигнал root после standRenew/build; runtime/test QA не менял.
TX2 SHA проверены: work-schedule.service.ts c1d66429092906908aec516e8d1d950d26757eada6b7d5ba129d50c489396169; work-schedule-session.spec.ts 1e02651b8dc8efb66b67d46969585c5bc7667540cd283a62bf4a965fc58dbae3.
run-release.ps1: preflight → полныйunit → tsc → explicit ESLint(51прежний+2TX2+текущийHEADdiff/untracked) → полный111e2e, одинJestпроцесс.
run-full.ps1:4ordinarybatch+6strictgroups последовательно,RAM6144,штатные60s,PAUSEmarkerпередкаждойгруппой; ordinaryDBdatacore-test-c236-run05.
StrictDBc172/c240-c242/c198-acts/T26 и disposable guard сохранены; ownedMongo27237 labelsC236/ephemeral иloopback проверены чтением.
PSParser всехhelper0errors; SHA всехTS фиксируется заново при разрешённом старте/перед111/после111. Старыеrun01–04 не перезаписываются.
