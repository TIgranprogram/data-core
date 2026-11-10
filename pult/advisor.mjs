// Экран «Что делать сейчас»: состояние проекта + журнал запусков → список дел с причиной и кнопкой.
// Чистая функция: сеть и диск не трогает. Ритм команд — поле every в catalog.mjs, поручения Claude — pult/todo.json.

export const LEVELS = [
  { id: 'urgent', title: 'Сначала это', hint: 'Что-то сломано. Остальное подождёт' },
  { id: 'you', title: 'Нужно от вас', hint: 'Claude сам этого сделать не может. Нажмите кнопку' },
  { id: 'today', title: 'Сегодня', hint: 'Дела на сегодня и то, что мешает выкладке' },
  { id: 'soon', title: 'Рекомендуется', hint: 'Подошёл срок. Можно сделать, когда будет время' },
];

const HOUR = 3600000;
const DAY = 24 * HOUR;
const POST_CHECK_AFTER = HOUR;
/** Проверки, чей последний итог всегда виден на экране «Что делать сейчас». */
const CHECKS = ['code-check', 'check-full', 'site-audit', 'day-start', 'day-errors'];
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

/** Ключ запуска: команда, а с полями (например, скрипт) — «команда?значения». */
export const runKey = (cmd, params) => (params && Object.keys(params).length ? `${cmd}?${Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&')}` : cmd);

/** На сайте уже этот код: версия известна и коммитов кода после неё нет. */
export const siteHasCurrentCode = (s) => !!(s?.version && s.undeployed === 0);

/** Поручение выполнено: «Сделано», команда прошла после постановки, либо выкладка уже на сайте. */
export function todoDone(t, runs, s = {}) {
  if (runs[`todo:${t.id}`]) return true;
  const r = t.cmd && runs[runKey(t.cmd, t.params)];
  if (r && r.code === 0 && r.at >= Date.parse(t.added)) return true;
  // выкладка с другого ПК / из пульта не записалась — смотрим version.json, а не runs.json
  if (t.cmd === 'deploy-release' && siteHasCurrentCode(s)) return true;
  return false;
}

/** Последняя из проверок CHECKS. Нет запусков — null. */
export function latestCheck(runs, ids = CHECKS) {
  let best = null;
  for (const id of ids) {
    const r = runs[id];
    if (!r?.at) continue;
    if (!best || r.at > best.at) best = { cmd: id, at: r.at, code: r.code, bad: r.bad || [], last: r.last || '' };
  }
  return best;
}

/** s — состояние из readStatus, runs — { id команды: { at, code, last, bad, commit } }, todo — поручения. */
export function advise(s, runs, commands, now = Date.now(), todo = []) {
  const items = [];
  const add = (level, cmd, why) => { if (!items.some((x) => x.cmd === cmd)) items.push({ level, cmd, why }); };
  const gateFiles = s.gateFiles || [];

  if (s.site === false) add('urgent', 'prod-doctor', 'Сайт не отвечает. Осмотр покажет причину.');
  const doctor = runs['prod-doctor'];
  if (doctor?.bad?.length) add('urgent', 'prod-doctor', `Прошлый осмотр нашёл: ${cut(doctor.bad[0], 130)} Передайте это Claude, затем повторите осмотр.`);
  const release = runs['deploy-release'];
  if (release && release.code !== 0 && !siteHasCurrentCode(s)) add('urgent', 'deploy-release', `Выкладка не прошла: ${cut(release.last || 'причина в журнале', 130)}`);
  if (s.route === null) add('urgent', 'setup-work', 'На этом ПК нет ключа входа на сервер. Кнопки сервера не работают.');

  const open = todo.filter((t) => !todoDone(t, runs, s));
  for (const t of open) {
    if (t.after && open.some((x) => x.id === t.after)) continue; // сначала предыдущий шаг
    // next — сколько шагов цепочки (after) ждут за этим пунктом: для кнопки «Выполнить все по очереди»
    let next = 0; for (let cur = t.id, n; (n = open.find((x) => x.after === cur)); cur = n.id) next++;
    items.push({ level: 'you', cmd: t.cmd, why: t.why, title: t.title, todo: t.id, link: !!t.link, ...(t.params ? { params: t.params } : {}), ...(next ? { next } : {}) }); // params — значения полей команды (скрипт и т. п.)
  }

  // Незакоммиченное — плашка сверху («Выкладка закрыта»), не пункт «нажмите / не нажимайте».
  if (s.behind) add('today', 'git-pull', `В GitHub есть новые коммиты: ${s.behind}. Заберите их до начала работы.`);
  if (s.ahead) add('today', 'git-push', `Коммиты не отправлены в GitHub: ${s.ahead}. Выкладка требует, чтобы они были там.`);
  if (s.undeployed && !gateFiles.length && !s.ahead) add('soon', 'deploy-release', `Не на сайте (можно копить и выложить пачкой): ${s.undeployed} ${s.undeployed === 1 ? 'изменение' : 'изменений'} в коде.`);

  if (release?.code === 0) {
    const post = runs['deploy-post'];
    const age = now - release.at;
    // Пока час не прошёл — пункт не показываем (нечего делать прямо сейчас).
    if ((!post || post.at < release.at) && age >= POST_CHECK_AFTER) add('today', 'deploy-post', 'После выкладки прошёл час. Проверьте новые ошибки с сайта.');
    if (!doctor || doctor.at < release.at) add('today', 'prod-doctor', 'После выкладки нужен осмотр сайта.');
  }

  if (s.nightStand && !s.testerRunning) add('soon', 'night-down', 'Стенд на копии базы запущен и занимает память ПК. Закончили проверку — остановите.');
  if (s.localSite) add('soon', 'stand-down', 'Локальный сайт запущен и занимает память ПК. Не нужен — остановите, данные останутся.');

  for (const c of commands) {
    if (!c.every) continue;
    const last = runs[c.id];
    const level = c.every === 1 ? 'today' : 'soon';
    if (!last) add(level, c.id, `${c.why}. Ещё не запускалось с этого ПК.`);
    else if (c.every === 1 ? !sameDay(last.at, now) : now - last.at >= c.every * DAY) {
      add(level, c.id, c.every === 1 ? `${c.why}.` : `${c.why}. Прошло дней: ${Math.floor((now - last.at) / DAY)}.`);
    }
  }

  const check = latestCheck(runs);
  if (check && (check.code !== 0 || check.bad.length)) {
    const level = check.code !== 0 ? 'urgent' : 'today';
    const why = check.code !== 0
      ? `Проверка не прошла: ${cut(check.last || 'смотрите журнал справа', 130)}`
      : `Проверка нашла: ${cut(check.bad[0], 130)}`;
    const hit = items.find((x) => x.cmd === check.cmd);
    if (!hit) items.push({ level, cmd: check.cmd, why });
    else { hit.level = level; hit.why = why; }
  }

  const done = commands.filter((c) => runs[c.id]?.code === 0 && sameDay(runs[c.id].at, now) && !items.some((x) => x.cmd === c.id))
    .map((c) => ({ cmd: c.id, at: runs[c.id].at }));
  return { items, done, check };
}
