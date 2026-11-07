# Приёмка C005 smoke — 2026-11-03

**Вердикт:** PARTIAL принят. Полный C005 не закрыт.

**От агента** [C005 invoice fixture smoke](ab699a81-2d03-44df-8985-288852320412): import-check и статика зелёные; VM-тесты упали на Node 24; браузер/дизайнер не делались.

**Node:** установлен **v20.20.2** в `%LOCALAPPDATA%\node-v20.20.2-win-x64`, в **User PATH первым**.  
(Program Files ещё v26 — после перезапуска терминала `node -v` должен быть v20.20.2.)

**VM-тесты (worktree, флаг `--experimental-vm-modules`):**  
invoice-workspace 21/21 · request-step 11/11 · invoice-price 5/5 — **PASS**.

**Следующий шаг (C005b):** браузер fixture + CHECKLIST → дизайнер.  
До merge/release — не трогать.
