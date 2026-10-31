# Страховочный чемоданчик data-core

Здесь всё, чего нет в GitHub: ключи, пароли, настройки. Архив зашифрован паролем. Пароль хранить отдельно от архива, не в телефоне рядом с файлом. Забытый пароль восстановить нельзя.

## Что внутри

| Папка в архиве | Что это | Куда положить на новом ПК |
|--|--|--|
| `ssh/` | Все ключи SSH и файл `config` | `C:\Users\<имя>\.ssh\` |
| `project/.env` | Настройки локального стенда | `D:\data-core\.env` |
| `project/deploy/synology/` | `config.env`, `CREDENTIALS.md`, `access.env`: доступ к VM и проду | `D:\data-core\deploy\synology\` |
| `project/remote-access/secret/` | Ключ выкладки с работы | `D:\data-core\remote-access\secret\` |
| `project/secrets/` | Ключ Google и вход для проверок | `D:\data-core\secrets\` |
| `project/SRV-ERP/` | Доступ ко второму серверу | `D:\data-core\SRV-ERP\` |
| `project/.claude/settings.local.json` | Разрешения ИИ на этом ПК | `D:\data-core\.claude\` |
| `claude-memory/` | Память ИИ о проекте | `C:\Users\<имя>\.claude\projects\D--data-core\memory\` |

## Какой ключ для чего

| Ключ | Куда ведёт |
|--|--|
| `kppdf80-vm` | Основная VM, из домашней сети |
| `datacore_work` | VM и VPS через интернет, выкладка с работы |
| `erp_server` | Второй сервер Sportin |
| `odr_github` | GitHub |
| `gemini_gw` | Шлюз Gemini |

## Новый компьютер: порядок

1. Установить Git, Node.js 20+, Docker Desktop, 7-Zip, Claude Code.
2. `git clone` проекта в `D:\data-core`.
3. Распаковать архив и разложить файлы по таблице.
4. В Git Bash: `chmod 600 ~/.ssh/*` для ключей.
5. Из `D:\data-core`: `tools\setup.cmd`, затем `tools\setup.cmd task`.
6. `node tools/allow-ai.mjs`.
7. `cd backend`, `npx pnpm install`.
8. Проверка: `tools\dc.cmd status`.

## Если потеряли телефон

Сразу сменить пароли и отозвать ключи: GitHub, VPS, VM, Sportin, Яндекс-Диск. Архив зашифрован, но смена закрывает риск полностью.
