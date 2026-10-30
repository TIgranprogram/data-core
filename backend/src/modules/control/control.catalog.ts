/**
 * CC-10/12: каталог показателей «Состояния сайта». Ключ — то, что лежит в `app_control_daily.m`.
 * `source`: 'now' — считается при снимке дня из того, что уже есть на сервере;
 * 'run' — берётся из последнего ночного прогона с ПК (`app_control_runs`);
 * 'none' — источника пока нет: значение всегда null (null ≠ 0: «не знаем», а не «ноль»).
 */
export type MetricGroup = 'avail' | 'speed' | 'errors' | 'data' | 'business' | 'storage' | 'backups' | 'code' | 'control';
export type MetricSource = 'now' | 'run' | 'none';

export interface MetricDef {
  key: string;
  label: string;
  group: MetricGroup;
  unit: string;
  source: MetricSource;
  /** Что нужно, чтобы показатель заработал (для source = 'none'). */
  needs?: string;
}

export const METRIC_GROUPS: Record<MetricGroup, string> = {
  avail: 'Доступность', speed: 'Скорость', errors: 'Ошибки', data: 'Данные', business: 'Работа компании',
  storage: 'Хранение', backups: 'Копии', code: 'Проверки кода', control: 'Разбор',
};

const m = (key: string, label: string, group: MetricGroup, unit: string, source: MetricSource, needs?: string): MetricDef =>
  ({ key, label, group, unit, source, ...(needs ? { needs } : {}) });

export const METRICS: readonly MetricDef[] = [
  m('avail.uptime_pct', 'Сайт был доступен', 'avail', '%', 'none', 'внешний опрос /health/ready'),
  m('avail.downtime_min', 'Минут простоя', 'avail', 'мин', 'none', 'внешний опрос /health/ready'),
  m('avail.restarts', 'Перезапусков сервера', 'avail', 'шт', 'none', 'журнал запусков контейнера'),
  m('avail.version', 'Версия сайта', 'avail', 'номер', 'none', 'запись версии при выкладке'),
  m('avail.deploys', 'Выкладок и откатов', 'avail', 'шт', 'none', 'журнал выкладок (devlog)'),

  m('speed.requests', 'Запросов к серверу за сутки', 'speed', 'шт', 'now'),
  m('speed.p50_ms', 'Ответ сервера, типичный', 'speed', 'мс', 'now'),
  m('speed.p95_ms', 'Ответ сервера, медленные 5%', 'speed', 'мс', 'now'),
  m('speed.slow_count', 'Запросов дольше 1 секунды', 'speed', 'шт', 'now'),
  m('speed.screen_p95_ms', 'Открытие экрана в приложении, медленные 5%', 'speed', 'мс', 'none', 'замеры экранов из браузера'),

  m('errors.total', 'Ошибок у пользователей', 'errors', 'шт', 'now'),
  m('errors.new_kinds', 'Новых видов ошибок', 'errors', 'шт', 'now'),
  m('errors.unhandled', 'Необработанных ошибок', 'errors', 'шт', 'now'),
  m('errors.http5xx', 'Сбоев сервера', 'errors', 'шт', 'now'),

  m('data.fill_total', 'Записей, которые нужно заполнить', 'data', 'шт', 'now'),
  m('data.fill_top', 'Самая большая группа незаполненного', 'data', 'шт', 'now'),
  m('data.integrity_issues', 'Нарушений в данных склада', 'data', 'шт', 'now'),
  m('data.dup_partners', 'Дублей контрагентов', 'data', 'шт', 'none', 'ночной поиск дублей'),
  m('data.dup_dicts', 'Дублей в справочниках', 'data', 'шт', 'none', 'ночной поиск дублей'),
  m('data.files_orphan', 'Файлов без ссылки', 'data', 'шт', 'none', 'ночная сверка файлов'),
  m('data.links_broken', 'Ссылок на пропавший файл', 'data', 'шт', 'none', 'ночная сверка файлов'),

  m('business.requests_open', 'Открытых заявок', 'business', 'шт', 'now'),
  m('business.requests_overdue', 'Просроченных заявок', 'business', 'шт', 'now'),
  m('business.orders_active', 'Заказов в работе', 'business', 'шт', 'now'),
  m('business.stock_moves', 'Движений склада за сутки', 'business', 'шт', 'now'),
  m('business.users_active', 'Пользователей, менявших данные', 'business', 'чел', 'now'),
  m('business.passports_issued', 'Выпущено паспортов за сутки', 'business', 'шт', 'now'),
  m('business.payments_overdue', 'Просроченных платежей', 'business', 'шт', 'none', 'правило «просрочен платёж»'),

  m('storage.disk_used_pct', 'Диск занят', 'storage', '%', 'now'),
  m('storage.disk_used_bytes', 'Занято на диске', 'storage', 'байт', 'now'),
  m('storage.db_bytes', 'Размер базы', 'storage', 'байт', 'now'),
  m('storage.uploads_bytes', 'Размер загруженных файлов', 'storage', 'байт', 'now'),
  m('storage.backups_bytes', 'Размер копий на сервере', 'storage', 'байт', 'now'),
  m('storage.auditlogs_bytes', 'Размер журнала действий', 'storage', 'байт', 'now'),
  m('storage.oplog_hours', 'Окно журнала репликации', 'storage', 'ч', 'now'),

  m('backups.local_age_h', 'Возраст последней копии на сервере', 'backups', 'ч', 'now'),
  m('backups.offsite_age_h', 'Возраст последней копии вне дома', 'backups', 'ч', 'now'),
  m('backups.drill_days', 'Дней с учебного восстановления', 'backups', 'дн', 'none', 'запись drill.log в базу'),
  m('backups.drill_ok', 'Учебное восстановление прошло', 'backups', '1/0', 'none', 'запись drill.log в базу'),

  m('code.steps_green', 'Шагов ночного прогона прошло', 'code', 'шт', 'run'),
  m('code.steps_red', 'Шагов ночного прогона упало', 'code', 'шт', 'run'),
  m('code.run_duration_s', 'Длительность ночного прогона', 'code', 'с', 'run'),
  m('code.e2e_ok', 'Сквозные проверки прошли', 'code', '1/0', 'run'),
  m('code.smoke_ok', 'Проверка экранов прошла', 'code', '1/0', 'run'),
  m('code.tests_total', 'Число тестов', 'code', 'шт', 'none', 'разбор вывода jest в прогоне'),
  m('code.lint_clean', 'Линтеры без замечаний', 'code', '1/0', 'none', 'шаг eslint и design-lint в прогоне'),
  m('code.files_over_400', 'Файлов длиннее 400 строк', 'code', 'шт', 'none', 'шаг подсчёта в прогоне'),
  m('code.vuln_high', 'Серьёзных уязвимостей', 'code', 'шт', 'none', 'шаг аудита зависимостей'),

  m('control.questions_open', 'Открытых вопросов в «Разборе»', 'control', 'шт', 'now'),
  m('control.age_median_d', 'Возраст вопроса, типичный', 'control', 'дн', 'now'),
  m('control.overdue', 'Просроченных вопросов', 'control', 'шт', 'now'),
  m('control.failed_actions', 'Сбоев кнопок', 'control', 'шт', 'now'),
];

export const METRIC_KEYS: readonly string[] = METRICS.map((x) => x.key);

/** Подпись источника для экрана: по-русски, без служебных слов. */
export function sourceNote(d: MetricDef): string {
  return d.source === 'now' ? 'считается сервером' : d.source === 'run' ? 'из ночного прогона' : `ещё нет источника${d.needs ? `: ${d.needs}` : ''}`;
}
