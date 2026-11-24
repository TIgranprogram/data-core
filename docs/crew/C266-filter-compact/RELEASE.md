# C266 — выпуск 24.11.2026

**v2.54** · тег `release-v2.54-d9c0c0d3` · PWA `d9c0c0d3` · backend `a9897e4a`

## Кандидат
- `350df4e9` — общий kit фильтров
- `1c01a096` — секции, отчёты, DEPLOY-PROMPT
- `d9c0c0d3` — тесты ворот под C266 (без «6м», открытие трубы в C242)

Чужие незакоммиченные (C157/C246/роли) не включались. Архив — git HEAD.

## Ворота и путь
- preflight ОК; путь через VPS (`remote-access/deploy.sh`) — прямой LAN 192.168.1.52 timeout.
- Первый заход: мост/замок занят; повтор — успех.
- Смоук 7/7, health 200. `--force-urgent` не использовали. CRM не поднимали.

## После выпуска (только чтение)
- `version.json`: `v=d9c0c0d3`, `b=a9897e4a`, `n=1053`
- health/ready 200
- Фильтры `#stock` трубы: раскрытие, поиск x/х, «Ещё», выбор, снятие, сброс — PASS  
  Лог: `tools/logs/c266-prod-stock-filters.json`

## Приёмка до выпуска
- [UI-REVIEW.md](UI-REVIEW.md) PASS · [REPORT-FINAL.md](REPORT-FINAL.md) · evidence-final/
