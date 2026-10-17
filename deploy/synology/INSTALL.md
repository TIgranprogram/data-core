# KPPDF 8.0 — Установка с нуля

> Пошаговая инструкция для нового развёртывания.  
> **Обычный update:** [`README.md`](./README.md) · чеклист [`RUNBOOK.md`](./RUNBOOK.md) · архитектура [`DEPLOY.md`](./DEPLOY.md)

---

## 1. Обзор

| Сервер | Роль |
|--------|------|
| **VPS** (<WAN_IP>) | nginx (SSL/HTTP/2) + SSH tunnel endpoint |
| **VM** (<LAN_IP>, Synology VMM) | Docker: backend + MongoDB |
| **Synology** (<NAS_IP>) | Хост для VM |

---

## 2. Подготовка VM (один раз)

### 2.1 Docker

```bash
ssh <SSH_USER>@<LAN_IP>
# скопировать и запустить server-setup-ubuntu.sh из репо
sudo bash server-setup-ubuntu.sh
```

### 2.2 Туннель к VPS

Если сервис `kppdf-tunnel` уже есть — пропусти. Иначе см. `DEPLOY.md` § SSH Reverse Tunnel / autossh.

### 2.3 SSL на VPS

```bash
ssh root@<WAN_IP>
certbot --nginx -d <DOMAIN> --non-interactive --agree-tos --email admin@<DOMAIN> --redirect
```

---

## 3. Первый деплой с dev-машины

```powershell
pip install -r deploy/synology/requirements.txt
copy deploy\synology\config.env.example deploy\synology\config.env
copy deploy\synology\CREDENTIALS.example.md deploy\synology\CREDENTIALS.md
# заполнить config.env (JWT, ADMIN_PASSWORD, SSH key/password, CORS=https://<DOMAIN>)

# чистая установка (только пока нет реальных данных):
.\deploy\synology\deploy.ps1 -Wipe -Seed
```

После успеха: в `config.env` оставить `WIPE=false`. Дальше только:

```powershell
.\deploy\synology\deploy.ps1
```

---

## 4. Проверка

- https://<DOMAIN>/api/health/ready → ok
- Логин `admin` + пароль из `CREDENTIALS.md`
- Ctrl+F5 если кэш старого CSS

---

## 5. Бэкап

```bash
ssh <SSH_USER>@<LAN_IP>
cd /opt/kppdf-8.0 && sudo bash backup.sh
```
