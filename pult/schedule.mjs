// Автозапуск: пока пульт открыт, он сам запускает команды по расписанию. Чистые функции — здесь, таймер — в server.mjs.
//
// Правило: { id, kind: 'daily'|'weekly'|'monthly', time: 'ЧЧ:ММ', day, enabled, params }
//   weekly — day 1..7 (пн..вс), monthly — day 1..28.
// Пропуск: ПК спал или пульт был закрыт в нужное время — команда идёт при следующем открытии,
// если с последнего срока её ещё не запускали. Запись на рабочий сайт автозапуск не делает никогда.

export const KINDS = { daily: 'Каждый день', weekly: 'Раз в неделю', monthly: 'Раз в месяц' };
export const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
export const SAFE_RISKS = new Set(['read', 'local']);

const at = (d, time) => { const [h, m] = time.split(':').map(Number); const x = new Date(d); x.setHours(h, m, 0, 0); return x; };

/** Последний срок правила не позже now (Date). */
export function lastSlot(rule, now = new Date()) {
  if (rule.kind === 'daily') {
    const t = at(now, rule.time);
    if (t > now) t.setDate(t.getDate() - 1);
    return t;
  }
  if (rule.kind === 'weekly') {
    const t = at(now, rule.time);
    const wd = (t.getDay() + 6) % 7 + 1; // 1 = пн
    t.setDate(t.getDate() - ((wd - rule.day + 7) % 7));
    if (t > now) t.setDate(t.getDate() - 7);
    return t;
  }
  const t = at(new Date(now.getFullYear(), now.getMonth(), rule.day), rule.time);
  if (t > now) t.setMonth(t.getMonth() - 1);
  return t;
}

/** Следующий срок после now. */
export function nextSlot(rule, now = new Date()) {
  const t = lastSlot(rule, now);
  if (rule.kind === 'daily') t.setDate(t.getDate() + 1);
  else if (rule.kind === 'weekly') t.setDate(t.getDate() + 7);
  else t.setMonth(t.getMonth() + 1);
  return t;
}

/** Пора запускать: правило включено и с последнего срока команда не шла (lastRunAt — мс или undefined). */
export function isDue(rule, lastRunAt, now = new Date()) {
  return !!rule.enabled && !(lastRunAt >= lastSlot(rule, now).getTime());
}

/** Проверка правки с экрана. Возвращает чистое правило или бросает ошибку с понятным текстом. */
export function cleanRule(base, patch) {
  const r = { ...base, ...patch };
  if (!KINDS[r.kind]) throw new Error('Неизвестный ритм');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)) throw new Error('Время — в виде ЧЧ:ММ');
  if (r.kind === 'weekly' && !(r.day >= 1 && r.day <= 7)) throw new Error('День недели — от пн до вс');
  if (r.kind === 'monthly' && !(r.day >= 1 && r.day <= 28)) throw new Error('День месяца — от 1 до 28');
  if (r.kind === 'daily') delete r.day;
  return { id: base.id, kind: r.kind, time: r.time, ...(r.day ? { day: Number(r.day) } : {}), enabled: !!r.enabled, ...(base.params ? { params: base.params } : {}) };
}

/** Правила этого ПК: умолчания каталога + сохранённые правки (файл в pult/logs, у каждого ПК свой). */
export function mergeRules(defaults, saved = {}) {
  return defaults.map((d) => {
    const s = saved[d.id];
    if (!s) return { ...d };
    try { return cleanRule(d, s); } catch { return { ...d }; }
  });
}

/** «пн 09:30», «1-го в 12:00», «в 09:00» — для экрана. */
export function ruleText(rule) {
  if (rule.kind === 'weekly') return `${KINDS.weekly}, ${WEEKDAYS[rule.day - 1]} в ${rule.time}`;
  if (rule.kind === 'monthly') return `${KINDS.monthly}, ${rule.day}-го в ${rule.time}`;
  return `${KINDS.daily} в ${rule.time}`;
}
