# KPPDF 8.0 — Runbook (краткий чеклист)

> **Старт здесь:** [`README.md`](./README.md)  
> **Архитектура:** [`DEPLOY.md`](./DEPLOY.md)  
> **Секреты:** [`CREDENTIALS.md`](./CREDENTIALS.md) (gitignore)  
> Обновлено: 2026-08-09 (warm deploy после WAVE-KP-USABLE + Unicode fix)

---

## Архитектура

```
https://kppdf-crm.ru → VPS nginx (443) → localhost:4200
                                              ↑
                    autossh reverse tunnel (VM→VPS)
                                              │
                    VM 192.168.1.52 (Synology Ubuntu)
                      └─ Docker: kppdf-backend:3000
                      └─ Docker: kppdf-mongo (4.4, rs0)
```

Канон домена: **`kppdf-crm.ru`**.  
`CORS_ORIGIN` (предпочтительно) = `https://kppdf-crm.ru`. Alias `CORS_ORIGINS` — legacy, тот же comma-separated список.

---

## Секреты (сгенерировать → host env / config.env)

Не коммитить. Только `config.env` (gitignored) + `CREDENTIALS.md` (gitignored).

```powershell
# 3 секрета (PowerShell):
-join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })   # JWT_SECRET
-join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })   # JWT_REFRESH_SECRET (другой!)
# ADMIN_PASSWORD: ≥12 символов, НЕ admin-change-me-immediately-in-production
```

```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # JWT_REFRESH_SECRET
```

Положить в `deploy/synology/config.env` → `deploy.py` пишет `/opt/kppdf-8.0/.env` → `docker compose up`.

---

## Pre-deploy checklist (10 строк)

1. **TZ-OPS-310 DONE** — есть `tasks/_archive/2026-08/TZ-OPS-310.done.md` и заполненный `docs/ops/server-harden-evidence.md`.  
   Иначе: VPN OFF → промпт `tasks/_backlog/ops/PROMPT-OPS-310-HARDEN.md` → закрыть harden → потом деплой.  
   Spec: `tasks/_backlog/ops/TZ-OPS-310-server-harden-before-deploy.md`.
2. **VPN OFF** — иначе LAN `192.168.1.52` часто недоступен.
3. `config.env` + `CREDENTIALS.md` скопированы из `*.example` и заполнены.
4. `JWT_SECRET` ≠ `JWT_REFRESH_SECRET`, оба ≥32; `ADMIN_PASSWORD` ≥12, не demo-default.
5. `CORS_ORIGIN=https://kppdf-crm.ru` (канон).
6. SSH: `DEPLOY_SSH_KEY` (предпочтительно) или `DEPLOY_PASSWORD`.
7. `WIPE=false` после первой чистой установки (не сносить живые данные).
8. FE artifact: `cd frontend-nx && pnpm exec nx build kppdf-web` → `frontend/browser/` (делает `deploy.py`; prod static = NX).
9. Compose health URL: `/api/health/ready`.
10. Первый логин: `admin` + пароль из CREDENTIALS (не admin123).  
    Снаружи ещё Basic Auth (`CREDENTIALS.md` § HTTP Basic Auth).
11. После up: smoke `/login`, `/materials`, `/orders` (с Basic Auth на публичном URL).

---

## Деплой одной командой

```powershell
# VPN OFF, из корня репо D:\kppdf-8.0, main == origin/main:
$env:PYTHONUTF8='1'
$env:PYTHONIOENCODING='utf-8'
.\deploy\synology\deploy.ps1              # обычный update (WIPE=false)
.\deploy\synology\deploy.ps1 -Seed        # + bootstrap restart
.\deploy\synology\deploy.ps1 -Wipe -Seed  # ТОЛЬКО по явному PO wipe
```

```bash
./deploy/synology/deploy.sh
./deploy/synology/deploy.sh --seed
```

Под капотом: `deploy.py` (pnpm build → SSH → docker compose → health/login).

Первый раз на ПК: см. [`README.md`](./README.md) § «Первый раз».

---

## Быстрая проверка

```text
https://kppdf-crm.ru/
https://kppdf-crm.ru/api/health/ready
```

```powershell
ssh -i $env:USERPROFILE\.ssh\kppdf80-vm tiit@192.168.1.52 "sudo docker ps"
curl http://192.168.1.52:3000/api/health/ready
```

Логин: `admin` + пароль из **CREDENTIALS.md** (не admin123).

### Stabilization Wave smoke (TZ-PROC-301)

```text
VPN OFF
1. GET /api/health/ready → ok
2. Login admin (CREDENTIALS.md)
3. Templates → Создать → A4 → builder opens
4. Add one text block → save (no category unavailable)
5. Texts: create block without categoryId → default «Общее»
6. Only one deploy at a time; docker ps = kppdf-backend + kppdf-mongo
```

Канон волны: [`docs/STABILIZATION-WAVE-2026-08.md`](../../docs/STABILIZATION-WAVE-2026-08.md).

---

## Типичные проблемы

| Симптом | Что сделать |
|---------|-------------|
| Ping/SSH VM timeout | Выключить VPN |
| Сайт без CSS + CSP `script-src-attr` | Уже починено в BE/FE; Ctrl+F5. Не должно повторяться |
| Login 401 | Неверный пароль **или** softlock (~15 мин после 5 ошибок). Верный пароль в CREDENTIALS; либо `python deploy/synology/reset-admin-password.py` |
| `/api/auth/me` 401 сразу после деплоя | Stale access после ротации JWT — refresh / re-login (Ctrl+F5) |
| `Default text-block category unavailable` | Seed `TextBlockCategoriesSeed` (slug `obshchee`) не в AppModule или категория inactive — см. README §уроки вечера |
| `POST /organizations` 500 «INN must be…» | Клиент не прислал ИНН; validation должна быть 400. Шаблоны: авто-org с `7707083893` |
| Два `docker build --no-cache` / VM «мёртвая» | Убить лишние build, один деплой с кэшем; на VM только kppdf compose |
| 502 на домене | Tunnel: на VPS `ss -tlnp \| grep :4200`; на VM `sudo systemctl restart kppdf-tunnel` |
| Backend unhealthy / mongo timeout | `rs.status()` на mongo; compose `mongo-init` должен поднять rs0 |
| Compose «не поднял» контейнеры | Смотри `deploy.py` docker шаг; не должно быть bare `build` вне `$DC` |
| Access expire → /login | Auth variant A: refresh JWT в JSON body. Если всё ещё падает — смотри softlock / секреты |

Деплой-канон и быстрый путь: [`README.md`](./README.md) (§флаги + уроки вечера).  
LM Studio local helper: [`docs/agents/LM-STUDIO-AGENT.md`](../../docs/agents/LM-STUDIO-AGENT.md).

---

## Бэкап MongoDB

```bash
ssh tiit@192.168.1.52
cd /opt/kppdf-8.0 && sudo bash backup.sh
# → /var/lib/kppdf80/backups/...
```

### Автоматическое расписание (cron)

Установить на VM (от root или docker-пользователя):

```bash
# crontab -e (на самом VM):
0 3 * * * cd /opt/kppdf-8.0 && bash deploy/synology/backup.sh >> /var/log/kppdf-backup.log 2>&1
```

Каждую ночь в 03:00. Ротация: старше `BACKUP_RETENTION_DAYS` (дефолт 14) удаляются автоматически.
Настроить в `deploy/synology/.env`: `BACKUP_RETENTION_DAYS=14` (или 0 для отключения ротации).

###uploads и mongodb — volume на хосте

`docker-compose.prod.yml` монтирует `${KPPDF_DATA_DIR}/mongodb` и `${KPPDF_DATA_DIR}/uploads`
как **volume на хосте**, вне контейнеров. Обычный `docker compose up -d --build`
**не удаляет** данные — база и загруженные файлы переживают передеплой.
Удаляет **только** явный `--wipe` (`deploy.py wipe_remote()`), что уже задокументировано
как опасная операция с требованием явного разрешения PO.

> Когда начнёте **реальную работу** — wipe/удаление данных запрещены без явного указания PO.  
> Канон вопроса PO по-русски + бэкап перед wipe: [`docs/ops/DANGEROUS-OPS.md`](../../docs/ops/DANGEROUS-OPS.md).

---

## TZ-AUTH-305 — auth_request вместо Basic (**ПРИМЕНЕНО 2026-08-15**)

- Политика: [`docs/ops/home-host-access.md`](../../docs/ops/home-host-access.md) §4.1.
- Rollout/rollback: [`DEPLOY.md`](./DEPLOY.md) §15b.
- Evidence: [`docs/ops/server-harden-evidence.md`](../../docs/ops/server-harden-evidence.md) § AUTH-305.
- Rollback: `cp kppdf-proxy.bak-auth-basic kppdf-proxy && nginx -t && systemctl reload nginx` (без БД/wipe).

## Источники

- [`README.md`](./README.md) — one-command
- [`DEPLOY.md`](./DEPLOY.md) — архитектура
- [`deploy.py`](./deploy.py) — реализация
- [`reset-admin-password.py`](./reset-admin-password.py) — сброс admin (`--password` ≥12)
