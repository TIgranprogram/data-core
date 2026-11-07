готово | п.1 ✅ причину "$sort photoId" точно не нашёл (в коде такого ключа нет, стенд недоступен: вход api.sh не удался); вероятная причина — сортировка `/supply/requests` без индекса упирается в лимит памяти Mongo 4.4 → добавлен `.allowDiskUse(true)` + тест; ПРОВЕРИТЬ на стенде
п.2 ✅ matching.service.ts `fillOrderName` (только пустое orderName, атомарно фильтром) + тест
п.3 ✅ `GET /health/backups/reminder` (admin/director; дата из журнала `backup.download` + выпуски devlog_releases после неё); админка: `backupNudge()` в admin.js при входе, блок #backup-nudge в index.html, css; без опроса
файлы: supply.service.ts(+spec), matching.service.ts(+spec), disk/backup-reminder.ts(+spec), backups.controller.ts, admin/{admin.js,index.html,admin.css}, docs/MAP.md
проверки: tsc 0; jest disk+matching+supply 144 зелёных; eslint ок; admin.js синтаксис ок
риски: п.1 не подтверждён на живых данных; п.3 вид в браузере не смотрел (нужен дизайнер); doctor-предупреждения из TASKS не трогал
