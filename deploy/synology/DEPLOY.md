# KPPDF 8.0 — Документация деплоя

> **Source of truth** для деплоя v8.  
> **Старт:** [`README.md`](./README.md) · чеклист [`RUNBOOK.md`](./RUNBOOK.md)  
> Секреты: [`CREDENTIALS.md`](./CREDENTIALS.md) (gitignore).  
> Последнее обновление: 2026-08-09 (warm deploy OK; agent entry в README)

---

## 1. Архитектура

```
┌──────────────────────────────────────────────────────────────┐
│                        ИНТЕРНЕТ                               │
│                                                              │
│   Пользователь → https://kppdf-crm.ru/                       │
└──────────────────────┬───────────────────────────────────────┘
                       │ DNS → 193.222.62.240
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  VPS (box-946037) — 193.222.62.240                           │
│  Ubuntu 26.04 LTS                                            │
│                                                              │
│  ┌───────────────┐     ┌──────────────────┐                  │
│  │ nginx:443     │────→│ localhost:4200   │←──── SSH tunnel   │
│  │ (HTTP/2+SSL)  │     │ (reverse tunnel) │     (autossh)    │
│  │ Let's Encrypt │     └──────────────────┘                  │
│  └───────────────┘                                           │
│                                                              │
│  SSL: /etc/letsencrypt/live/kppdf-crm.ru/                    │
│  Автопродление: certbot timer (ежедневно)                    │
└──────────────────────────────┬───────────────────────────────┘
                               │
          ╔════ SSH reverse tunnel ════╗
          ║  VM → VPS: -R 4200:3000   ║
          ╚════════════════════════════╝
                               │
┌──────────────────────────────────────────────────────────────┐
│  Synology NAS (10.0.0.47)                                    │
│  VMM: Ubuntu VM "ubuntu24kppdf_8"                            │
│                                                              │
│  ┌─────────────────────────────────────────┐                 │
│  │  VM — 192.168.1.52                     │                 │
│  │                                         │                 │
│  │  ┌────────────────┐  ┌───────────────┐  │                 │
│  │  │ kppdf-backend  │  │ kppdf-mongo   │  │                 │
│  │  │ :3000 (Docker) │  │ :27017 (Docker)│ │                 │
│  │  └────────────────┘  └───────────────┘  │                 │
│  │  /opt/kppdf-8.0/                        │                 │
│  │  /var/lib/kppdf80/                      │                 │
│  └─────────────────────────────────────────┘                 │
└──────────────────────────────────────────────────────────────┘
```

### Цепочка запроса

```
1. Браузер → https://kppdf-crm.ru/ (DNS: 193.222.62.240)
2. VPS nginx:443 (HTTP/2 + SSL) → proxy_pass http://localhost:4200
3. localhost:4200 → SSH reverse tunnel (autossh systemd)
4. SSH tunnel → VM localhost:3000 → Docker kppdf-backend
5. Backend → MongoDB (kppdf-mongo, replica set rs0)
```

### Почему туннель

VPS (193.222.62.240) и VM (192.168.1.52) в разных сетях. Synology NAS (10.0.0.47) — хост VM, но не маршрутизируется до VPS. Единственный способ связать их — SSH reverse tunnel, который VM сама устанавливает к VPS.

---

## 2. Текущий статус

| Компонент | Статус | Детали |
|-----------|--------|--------|
| Домен kppdf-crm.ru | ✅ | DNS → 193.222.62.240 |
| SSL сертификат | ✅ | Let's Encrypt,到期 2026-10-23, автопродление |
| nginx на VPS | ✅ | HTTP/2, SSL, gzip, кеширование статики |
| SSH tunnel | ✅ | autossh + systemd, автоперезапуск 10 сек |
| Backend на VM | ✅ | Docker kppdf-backend, healthy |
| MongoDB на VM | ✅ | Docker kppdf-mongo 4.4, replica set rs0, healthy |
| CORS | ✅ | http + https kppdf-crm.ru |

---

## 3. Серверы

| Сервер | IP | Роль |
|--------|-----|------|
| **VPS** | `193.222.62.240` | nginx (SSL termination) + SSH tunnel endpoint |
| **VM** | `192.168.1.52` (LAN) | Docker: backend + MongoDB |
| **Synology** | `10.0.0.47` (LAN) | VMM: Ubuntu VM |

---

## 4. SSH доступ

| Сервер | Команда | Секреты |
|--------|---------|---------|
| VPS | `ssh root@193.222.62.240` | см. `CREDENTIALS.md` |
| VM | `ssh -i %USERPROFILE%\.ssh\kppdf80-vm tiit@192.168.1.52` | ключ / пароль в `CREDENTIALS.md` |

**Не хранить пароли в этом файле.** VM доступна по LAN; при включённом VPN часто недоступна.

---

## 5. Nginx конфиг (VPS)

Файл: `/etc/nginx/sites-available/kppdf-proxy`

```nginx
server {
    server_name kppdf-crm.ru 193.222.62.240 _;
    client_max_body_size 10M;
    http2 on;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Статика — кеширование 30 дней
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2|woff|ttf|eot)$ {
        proxy_pass http://127.0.0.1:4200;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        expires 30d;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    location = /robots.txt {
        alias /var/www/html/robots.txt;
        access_log off;
        log_not_found off;
    }

    location = /favicon.ico {
        access_log off;
        log_not_found off;
    }

    location / {
        proxy_pass http://127.0.0.1:4200;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }

    listen [::]:443 ssl ipv6only=on;
    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/kppdf-crm.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/kppdf-crm.ru/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server {
    if ($host = kppdf-crm.ru) {
        return 301 https://$host$request_uri;
    }
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name kppdf-crm.ru 193.222.62.240 _;
    return 404;
}
```

---

## 6. SSH Reverse Tunnel (autossh)

Туннель инициируется **с VM** к VPS. Systemd сервис `kppdf-tunnel`.

```bash
# На VM:
sudo systemctl status kppdf-tunnel    # статус
sudo systemctl restart kppdf-tunnel   # перезапуск
sudo journalctl -u kppdf-tunnel -n 50 --no-pager  # логи

# Проверка (с VPS):
curl -4 -s http://127.0.0.1:4200/api/health
ss -tlnp | grep :4200
```

---

## 7. Docker (на VM)

| Контейнер | Образ | Порт | Описание |
|-----------|-------|------|----------|
| `kppdf-backend` | kppdf-80-backend | `0.0.0.0:3000` | NestJS API |
| `kppdf-mongo` | mongo:4.4 | `127.0.0.1:27017` | MongoDB RS |

```bash
docker ps                                          # статус
docker logs kppdf-backend --tail=50                # логи
docker compose -f docker-compose.prod.yml restart backend
docker compose -f docker-compose.prod.yml up -d --build
```

---

## 8. Конфигурация (.env на VM)

Файл: `/opt/kppdf-8.0/.env` — **генерируется `deploy.py` из локального `config.env`**.

Обязательные ключи:

```
JWT_SECRET=<64 hex>
JWT_REFRESH_SECRET=<другой 64 hex>
ADMIN_PASSWORD=<сильный, ≥12, НЕ demo-default>
CORS_ORIGIN=https://kppdf-crm.ru
KPPDF_DATA_DIR=/var/lib/kppdf80
TRUST_PROXY=1
```

Значения — только в gitignored `deploy/synology/config.env` / `CREDENTIALS.md`.

После ручного изменения `.env` на сервере:

```bash
cd /opt/kppdf-8.0 && sudo docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps backend
```

---

## 9. Деплой

> **Prod UI target = NX.** Канон cutover: [`docs/ops/DEPLOY-NX-PROD.md`](../../docs/ops/DEPLOY-NX-PROD.md).  
> Штамп: [`docs/agent-checklists/DEPLOY-READY.md`](../../docs/agent-checklists/DEPLOY-READY.md).  
> `deploy.py` уже собирает `nx build kppdf-web` — деплоить «по документации» только когда штамп `status: READY` + `frontend_target: nx`.

### 9.1 Первичная настройка (один раз)

См. [`INSTALL.md`](./INSTALL.md) и [`README.md`](./README.md).

Кратко: Docker на VM (`server-setup-ubuntu.sh`), туннель `kppdf-tunnel`, SSL на VPS, локально `config.env` + SSH-ключ.

### 9.2 Обновление приложения (канон)

**Одна команда (рекомендуется):**

```powershell
.\deploy\synology\deploy.ps1
# или
.\deploy\synology\deploy.ps1 -Seed
```

```bash
./deploy/synology/deploy.sh
./deploy/synology/deploy.sh --seed
```

Эквивалент:

```powershell
pip install -r deploy/synology/requirements.txt
python deploy/synology/deploy.py
```

> Устаревшие пути `deploy-node.cjs` / старый `deploy.ps1` без wrapper — **не использовать**. Канон: `deploy.py` + `deploy.ps1`/`deploy.sh`.

### 9.3 Что делает деплой

1. Сборка FE: `cd frontend-nx && pnpm exec nx build kppdf-web` → копия в `frontend/browser/`  
   (prod static = NX; legacy `pnpm --dir frontend build` больше не вызывается deploy.py, TZ-OPS-DEPLOY-NX-STATIC закрыт).
2. Архив: `backend/`, `frontend/browser/`, `docker-compose.prod.yml`, `backup.sh`
3. SSH (ключ или пароль) → upload в `/opt/kppdf-8.0/`
4. Запись `.env` из `config.env`
5. Опционально `--wipe` (app + mongo data) — только по `DANGEROUS-OPS` + фразе PO
6. `docker compose build backend && up -d` + ожидание rs0
7. Health `/api/health/ready` + пробный login admin

---

## 10. Верификация

```bash
# 1. Backend (на VM):
curl http://localhost:3000/api/health/ready
# → {"status":"ok","info":{"mongo":{"status":"up"},...}}

# 2. Туннель (с VPS):
curl -4 -s http://127.0.0.1:4200/api/health/ready

# 3. HTTPS:
https://kppdf-crm.ru/
https://kppdf-crm.ru/api/health/ready
```

**Логин:** `admin` + пароль из `CREDENTIALS.md` (не demo-default / не admin123).

---

## 11. SSL сертификат (Let's Encrypt)

```bash
# Установка certbot (на VPS):
apt-get install -y certbot python3-certbot-nginx

# Получение сертификата:
certbot --nginx -d kppdf-crm.ru --non-interactive --agree-tos --email admin@kppdf-crm.ru --redirect

# Автопродление (настроено автоматически):
systemctl status certbot.timer

# Ручное обновление:
certbot renew --dry-run
```

Сертификат: `/etc/letsencrypt/live/kppdf-crm.ru/`
- `fullchain.pem` — цепочка сертификатов
- `privkey.pem` — приватный ключ

---

## 12. Troubleshooting

| # | Проблема | Причина | Решение |
|---|----------|---------|---------|
| 1 | **502 Bad Gateway** | Туннель упал | `ssh tiit@192.168.1.52 "sudo systemctl restart kppdf-tunnel"` |
| 2 | **502 Bad Gateway** | Backend упал | `ssh tiit@192.168.1.52 "sudo docker restart kppdf-backend"` |
| 3 | **ERR_CONNECTION_REFUSED** (порт 443) | SSL не настроен | `certbot --nginx -d kppdf-crm.ru --redirect` |
| 4 | **CORS error** | URL нет в CORS_ORIGIN | Добавить в `.env` на VM + `--force-recreate backend` |
| 5 | MongoDB AVX error | CPU Synology без AVX | `mongo:4.4` (уже используется) |
| 6 | `no replset config` | RS не инициализирован | `docker exec kppdf-mongo mongo --eval "rs.initiate(...)"` |
| 7 | Frontend пуст | `browser/` пуст | `cd frontend-nx && pnpm exec nx build kppdf-web && cp -r dist/apps/kppdf-web/browser/* ../frontend/browser/` |
| 8 | Сертификат истёк | certbot не обновился | `certbot renew --force-renewal` |
| 9 | Туннель не переподключается | autossh завис | `sudo systemctl restart kppdf-tunnel` на VM |

---

## 13. Пути на VM

| Путь | Назначение |
|------|------------|
| `/opt/kppdf-8.0/` | Код приложения (перезаписывается при деплое) |
| `/opt/kppdf-8.0/.env` | JWT + CORS конфиг |
| `/opt/kppdf-8.0/docker-compose.prod.yml` | Docker Compose production |
| `/var/lib/kppdf80/mongodb/` | MongoDB data (сохраняется) |
| `/var/lib/kppdf80/uploads/` | Загруженные файлы (**volume**, не в git / не в image) |
| `/var/lib/kppdf80/backups/` | Ручные бэкапы |

### Uploads / медиа (важно для деплоя)

- Обычный деплой / rebuild контейнеров **не** удаляет `/var/lib/kppdf80/uploads/`.
- Флаг `--wipe` / `-Wipe` удаляет mongo **и** uploads — только demo/dev, не на живых данных.
- Перед рискованными операциями: `backup.sh` (mongo + uploads).
- Канон подпапок:
  - `uploads/document-templates/{templateId}/` — фоны шаблонов;
  - `uploads/template-blocks/{blockId}/` — фото блоков конструктора (**TZ-DOC-333 закрыт**: upload через `POST /template-blocks/:id/image`, в Mongo пишется `/uploads/template-blocks/...`; `blob:`/`data:` в `settings.imageUrl` → 400).
- Устаревшие `blob:` URL из Mongo рендерятся как «нет изображения» (soft-guard); ручной cleanup не обязателен.
- Аудит: `docs/audits/DOC-333-photo-persist-audit.md`.

---

## 14. Отличия от kppdf-3.0

| | kppdf-3.0 | kppdf-8.0 |
|---|-----------|-----------|
| API prefix | `/api/v1/` | `/api/` |
| Health | `/api/v1/health` | `/api/health` |
| Frontend dist | `dist/kppdf-3.0/browser` | `frontend-nx/dist/apps/kppdf-web/browser` (staged → `frontend/browser/`) |
| Data dir | `/var/lib/kppdf` | `/var/lib/kppdf80` |
| Remote dir | `/opt/kppdf-3.0` | `/opt/kppdf-8.0` |
| Mongo | 7.x (AVX required) | **4.4** (AVX-free) |
| SSL | Нет | **Let's Encrypt + HTTP/2** |
| Туннель | Нет | **autossh + systemd** |
| Деплой | deploy.py | **deploy.ps1 / deploy.sh → deploy.py** |
| Домен | sport-set.ru | **kppdf-crm.ru** |

---

## 15b. TZ-AUTH-305 — `auth_request` вместо Basic (**ПРИМЕНЕНО 2026-08-15**)

> **Статус:** cutover выполнен на VPS `box-946037` после команды PO
> `деплой / убирай подъезд`. Политика: `docs/ops/home-host-access.md` §4.1.
> Бэкап: `/etc/nginx/sites-available/kppdf-proxy.bak-auth-basic`.

### Rollout (когда PO скажет «деплой»)

1. На VPS сохранить текущий рабочий конфиг как бэкап:
   ```bash
   cp /etc/nginx/sites-available/kppdf-proxy /etc/nginx/sites-available/kppdf-proxy.bak-auth-basic
   ```
2. Добавить `internal` location `/internal/device-check` → `proxy_pass` на
   `http://127.0.0.1:4200/api/device/auth-check` (проброс `Cookie`).
3. Снять Basic с enrollment route (`/enroll/` + POST `device/enroll|status|session`)
   и подтвердить активацию тестового invite.
4. Включить `auth_request /internal/device-check` на UI `/`; проверить active/revoked
   и owner-device link.
5. Только после PASS убрать `auth_basic` с основного UI. `/api/` — всегда без
   `auth_basic` и без `auth_request` (JWT/`kppd_` сами закрывают API).
6. `nginx -t && systemctl reload nginx` после каждой правки.

### Rollback (одна операция, без БД и без wipe)

```bash
cp /etc/nginx/sites-available/kppdf-proxy.bak-auth-basic /etc/nginx/sites-available/kppdf-proxy
nginx -t && systemctl reload nginx
```

Никаких изменений Mongo/data, backend, Desktop или кода — только nginx.

### Запрещено

- Не трогать VM `:3000`, SSH reverse tunnel, DNS, TLS.
- Не включать `auth_request`/Basic на `/api` (сломает JWT, Desktop `kppd_`, CORS preflight).
- Не менять `deploy.ps1`/`deploy.py`/`preflight.ps1` под переключение — это ручной ops-шаг на VPS nginx, не часть app-деплоя.

---

## 15. История

| Дата | Событие |
|------|---------|
| 2026-08-02 | Clean wipe+deploy; auth refresh в body; CSP/CSS; one-command `deploy.ps1`/`deploy.sh`; README; **TZ-DOC-333** — persist фото блоков (disk `uploads/template-blocks/` + reject blob) |
| 2026-07-25 | **v5** — HTTPS (Let's Encrypt), HTTP/2, gzip, кеширование статики, robots.txt |
| 2026-07-25 | **v4** — Туннель создан, CORS исправлен, всё работает |
| 2026-07-25 | **v3** — VPS подготовлен, setup-tunnel-vm.sh создан |
| 2026-07-25 | v2 — Диагностика VPS, nginx настроен |
| 2026-07-25 | v1 — Первый деплой v8 |
| 2026-07-13 | VM `ubuntu24kppdf_8` создана |
