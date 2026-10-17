# Deploy connect audit — 2026-08-02 (read-only)

> Контрольное подключение **без** изменений на сервере.  
> Автор: Cursor. Не коммитить секреты сюда.

## Архитектура (из docs)

```
Internet → https://kppdf-crm.ru (VPS 193.222.62.240 nginx:443)
              → reverse tunnel :4200
                    → Ubuntu VM на Synology (LAN 192.168.1.103)
                         Docker: kppdf-backend:3000 + kppdf-mongo
```

Домен в старых кусках docs также `sport-set.ru` — **сейчас не отвечает нормально**.

## Результаты проб (повтор после VPN off — 2026-08-02 ~20:02)

| Проба | Результат |
|-------|-----------|
| Ping `192.168.1.103` | **OK** (0% loss) |
| `http://192.168.1.103:3000/api/health` | **200** |
| SSH key BatchMode | fail (ключей нет) |
| SSH password `tiit@192.168.1.103` (paramiko) | **OK** — host `ubuntuserver` |
| `/opt/kppdf-8.0` | есть: backend, frontend, compose, `.env` |
| docker | `kppdf-backend` Up 8d healthy; `kppdf-mongo` Up 8d healthy |

**Вывод после VPN off:** LAN + SSH + backend доступны. Деплой возможен по паролю (paramiko/`deploy.py`). Ключи SSH всё ещё не настроены на этой Windows-машине.

## Вывод

1. Публичный сайт **kppdf-crm.ru** доступен с dev-машины (VPN не мешает HTTPS).
2. Домашний LAN/Synology VM **недоступны при текущем VPN** — для деплоя нужен SSH на `192.168.1.103` → **выключить VPN** и повторить.
3. На этой Windows-машине **нет SSH-ключей** для VPS/VM → либо восстановить ключи, либо password-auth (пароли есть в `RUNBOOK.md`, но лучше перенести в gitignored `CREDENTIALS.md`).
4. Автодеплой «одной кнопкой» сейчас **не готов**: нет `CREDENTIALS.md`/`config.env`, нет ключей, битые ссылки на скрипты, канон домена разъехался.

## Что нужно от PO перед реальным update

1. Выключить VPN → подтвердить `ping 192.168.1.103` и `ssh tiit@192.168.1.103`.
2. Создать локально (gitignore): `CREDENTIALS.md` + `config.env` из example + паролей.
3. Решить канон URL: **kppdf-crm.ru** (живой) vs sport-set.ru.
4. Не деплоить, пока не закрыт **TZ-DEPLOY-301** (auth refresh + prod secrets), иначе после обновления сессии/boot могут сломаться.

## После успешного деплоя (TODO docs)

Заполнить § «Заметки» в CREDENTIALS.md + обновить RUNBOOK: рабочий хост, ключ, команда одной строки, VPN caveat.
